// Capture a meeting: what the speakers are playing, plus the microphone,
// summed into one mono MP3.
//
// Why this is native code at all: ffmpeg on Windows can only open *capture*
// endpoints through dshow, and a machine with no Stereo Mix and no virtual
// cable has no capture endpoint carrying the meeting's audio. WASAPI can open
// a *render* endpoint in loopback mode, which is a different thing entirely
// and the only way to hear the far end without a screen-share prompt.
//
// Two clocks, one timeline. The microphone and the speakers are independent
// devices that drift, and loopback in particular delivers nothing at all while
// the render endpoint is idle, so a mixer that just zips the two streams
// together would slide out of sync the first time nobody spoke. Instead the
// output timeline is wall clock: every 100 ms the mixer works out how many
// samples *should* exist by now, takes that many from each source, and pads
// with silence whatever a source could not supply. A silent gap stays a silent
// gap rather than pulling everything after it earlier.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use mp3lame_encoder::{Builder, FlushNoGap, MonoPcm};
use serde::Serialize;
use wasapi::{
    Direction, DeviceEnumerator, SampleType, StreamMode, WaveFormat,
};

/// Everything is resampled to this before mixing. Speech recognition gains
/// nothing above it and the upload is what actually costs time.
const RATE: usize = 48_000;
/// How often the mixer wakes up to reconcile the sources against the clock.
const TICK: Duration = Duration::from_millis(100);
/// A source that runs ahead of wall clock is drifting, not useful. Cap its
/// backlog so a misreporting device cannot grow the queue without limit.
const MAX_BACKLOG: usize = RATE * 3;

#[derive(Clone, Debug, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// List the endpoints of one direction. `Render` devices are the ones that can
/// be captured in loopback mode, which is why speakers show up as a recording
/// source in the UI.
///
/// Runs on a thread of its own because COM apartments are per-thread and this
/// is called from a Tauri command, whose thread may already have been
/// initialized as single-threaded by the webview. Owning the thread means the
/// apartment is ours and the answer does not depend on who asked.
pub fn list_devices(render: bool) -> Result<Vec<DeviceInfo>> {
    std::thread::spawn(move || enumerate(render))
        .join()
        .map_err(|_| anyhow!("Listing the audio devices failed unexpectedly"))?
}

fn enumerate(render: bool) -> Result<Vec<DeviceInfo>> {
    com_init();
    let direction = if render { Direction::Render } else { Direction::Capture };
    let enumerator = DeviceEnumerator::new().map_err(|e| anyhow!("{e}"))?;
    let default_id = enumerator
        .get_default_device(&direction)
        .ok()
        .and_then(|d| d.get_id().ok());
    let collection = enumerator
        .get_device_collection(&direction)
        .map_err(|e| anyhow!("{e}"))?;
    let count = collection.get_nbr_devices().map_err(|e| anyhow!("{e}"))?;

    let mut out = Vec::new();
    for i in 0..count {
        let Ok(device) = collection.get_device_at_index(i) else {
            continue;
        };
        let (Ok(id), Ok(name)) = (device.get_id(), device.get_friendlyname()) else {
            continue;
        };
        let is_default = default_id.as_deref() == Some(id.as_str());
        out.push(DeviceInfo { id, name, is_default });
    }
    Ok(out)
}

/// COM has to be initialized on every thread that touches WASAPI, and it is
/// harmless to call more than once.
fn com_init() {
    let _ = wasapi::initialize_mta().ok();
}

// ---------------------------------------------------------------------------
// One capture source
// ---------------------------------------------------------------------------

struct Source {
    label: &'static str,
    queue: Arc<Mutex<VecDeque<f32>>>,
    error: Arc<Mutex<Option<String>>>,
    /// Set once the device has actually handed over a non-silent frame, so the
    /// UI can say "nothing is coming from the microphone" while there is still
    /// time to fix it.
    heard: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

/// Turn one device's native frames into mono samples at `RATE`.
///
/// Written as a struct because resampling has to carry its fractional read
/// position across calls; restarting from zero every buffer would put a click
/// at every packet boundary.
struct Converter {
    channels: usize,
    ratio: f64,
    position: f64,
    /// Last frame of the previous buffer, so interpolation spans the seam.
    previous: f32,
    primed: bool,
}

impl Converter {
    fn new(channels: usize, rate: usize) -> Self {
        Self {
            channels,
            ratio: rate as f64 / RATE as f64,
            position: 0.0,
            previous: 0.0,
            primed: false,
        }
    }

    /// `frames` is interleaved mono-able input; returns mono at `RATE`.
    fn push(&mut self, frames: &[f32], out: &mut Vec<f32>) {
        if self.channels == 0 {
            return;
        }
        let count = frames.len() / self.channels;
        if count == 0 {
            return;
        }
        // Downmix first: every channel carries some of the conversation, and
        // the transcript has no use for stereo.
        let mono: Vec<f32> = (0..count)
            .map(|i| {
                let start = i * self.channels;
                frames[start..start + self.channels].iter().sum::<f32>() / self.channels as f32
            })
            .collect();

        if !self.primed {
            self.previous = mono[0];
            self.primed = true;
        }

        // Linear interpolation. The rates involved are 44.1k/48k and their
        // relatives, so nothing here is a big stretch, and speech survives it
        // far better than it survives a dropped packet.
        while self.position < count as f64 {
            let index = self.position.floor();
            let frac = (self.position - index) as f32;
            let i = index as usize;
            let a = if i == 0 { self.previous } else { mono[i - 1] };
            let b = mono[i.min(count - 1)];
            out.push(a + (b - a) * frac);
            self.position += self.ratio;
        }
        self.position -= count as f64;
        self.previous = mono[count - 1];
    }
}

/// Open one endpoint and pump it into `queue` until `running` clears.
///
/// `loopback` decides which of the two things this is: a normal capture
/// endpoint (the microphone), or a render endpoint opened for capture, which
/// is what makes WASAPI hand over what is being played.
fn capture_thread(
    device_id: String,
    loopback: bool,
    queue: Arc<Mutex<VecDeque<f32>>>,
    running: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    heard: Arc<AtomicBool>,
) {
    if let Err(e) = capture_inner(device_id, loopback, &queue, &running, &heard) {
        *error.lock().unwrap() = Some(e.to_string());
    }
}

fn capture_inner(
    device_id: String,
    loopback: bool,
    queue: &Arc<Mutex<VecDeque<f32>>>,
    running: &Arc<AtomicBool>,
    heard: &Arc<AtomicBool>,
) -> Result<()> {
    com_init();
    let endpoint = if loopback { Direction::Render } else { Direction::Capture };
    let enumerator = DeviceEnumerator::new().map_err(|e| anyhow!("{e}"))?;
    let device = if device_id.is_empty() {
        enumerator
            .get_default_device(&endpoint)
            .map_err(|e| anyhow!("{e}"))?
    } else {
        // A remembered device can disappear (unplugged headset, docked
        // laptop). Falling back to the default beats failing the recording.
        enumerator
            .get_device(&device_id)
            .or_else(|_| enumerator.get_default_device(&endpoint))
            .map_err(|e| anyhow!("{e}"))?
    };

    let mut client = device.get_iaudioclient().map_err(|e| anyhow!("{e}"))?;

    // Ask for float samples at our own rate and let the audio engine convert.
    // If the device will not take that, fall back to its mix format and do the
    // conversion here instead — either way the mixer sees mono f32 at RATE.
    let desired = WaveFormat::new(32, 32, &SampleType::Float, RATE, 2, None);
    let mode = StreamMode::PollingShared {
        autoconvert: true,
        // 200 ms of device buffer. Loopback is polled, not event driven,
        // because the event never fires while the endpoint is idle.
        buffer_duration_hns: 2_000_000,
    };

    // Direction::Capture on a render device is what sets the loopback flag.
    let format = match client.initialize_client(&desired, &Direction::Capture, &mode) {
        Ok(()) => desired,
        Err(_) => {
            let mut client2 = device.get_iaudioclient().map_err(|e| anyhow!("{e}"))?;
            let mix = client2.get_mixformat().map_err(|e| anyhow!("{e}"))?;
            client2
                .initialize_client(&mix, &Direction::Capture, &mode)
                .map_err(|e| anyhow!("{e}"))?;
            client = client2;
            mix
        }
    };

    let channels = format.get_nchannels() as usize;
    let rate = format.get_samplespersec() as usize;
    let bits = format.get_bitspersample() as usize;
    let sample_type = format.get_subformat().map_err(|e| anyhow!("{e}"))?;
    let block_align = format.get_blockalign() as usize;
    if block_align == 0 {
        return Err(anyhow!("Device reported a zero-length frame"));
    }

    let capture = client.get_audiocaptureclient().map_err(|e| anyhow!("{e}"))?;
    client.start_stream().map_err(|e| anyhow!("{e}"))?;

    let mut converter = Converter::new(channels, rate);
    let mut raw: VecDeque<u8> = VecDeque::with_capacity(block_align * RATE);
    let mut frames: Vec<f32> = Vec::with_capacity(RATE);
    let mut converted: Vec<f32> = Vec::with_capacity(RATE);

    while running.load(Ordering::Relaxed) {
        let before = raw.len();
        let info = capture
            .read_from_device_to_deque(&mut raw)
            .map_err(|e| anyhow!("{e}"))?;
        // WASAPI may hand back a buffer marked silent whose memory was never
        // written. Taking it at face value records whatever was in it.
        if info.flags.silent && raw.len() > before {
            for byte in raw.iter_mut().skip(before) {
                *byte = 0;
            }
        }

        // Whole frames only — a partial frame at the tail stays for next time.
        let usable = (raw.len() / block_align) * block_align;
        if usable > 0 {
            frames.clear();
            let bytes: Vec<u8> = raw.drain(..usable).collect();
            decode_samples(&bytes, bits, sample_type, &mut frames);
            if !heard.load(Ordering::Relaxed) && frames.iter().any(|s| s.abs() > 0.0005) {
                heard.store(true, Ordering::Relaxed);
            }
            converted.clear();
            converter.push(&frames, &mut converted);
            if !converted.is_empty() {
                let mut q = queue.lock().unwrap();
                q.extend(converted.iter().copied());
                // Bound the backlog. Dropping the oldest keeps the source
                // close to real time rather than replaying an ever older past.
                while q.len() > MAX_BACKLOG {
                    q.pop_front();
                }
            }
        }

        thread::sleep(Duration::from_millis(10));
    }

    let _ = client.stop_stream();
    Ok(())
}

/// Interpret the endpoint's raw bytes as f32 samples in -1.0..=1.0.
fn decode_samples(bytes: &[u8], bits: usize, sample_type: SampleType, out: &mut Vec<f32>) {
    match (sample_type, bits) {
        (SampleType::Float, 32) => {
            for c in bytes.chunks_exact(4) {
                out.push(f32::from_le_bytes([c[0], c[1], c[2], c[3]]));
            }
        }
        (SampleType::Float, 64) => {
            for c in bytes.chunks_exact(8) {
                let v = f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]);
                out.push(v as f32);
            }
        }
        (SampleType::Int, 16) => {
            for c in bytes.chunks_exact(2) {
                out.push(i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0);
            }
        }
        (SampleType::Int, 24) => {
            for c in bytes.chunks_exact(3) {
                let v = ((c[2] as i32) << 24 | (c[1] as i32) << 16 | (c[0] as i32) << 8) >> 8;
                out.push(v as f32 / 8_388_608.0);
            }
        }
        (SampleType::Int, 32) => {
            for c in bytes.chunks_exact(4) {
                out.push(i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f32 / 2_147_483_648.0);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

pub struct Recording {
    pub path: PathBuf,
    pub seconds: f64,
    /// True when the microphone produced audible signal at some point.
    pub heard_mic: bool,
    /// True when the speakers produced audible signal at some point.
    pub heard_system: bool,
}

pub struct Recorder {
    running: Arc<AtomicBool>,
    /// Cleared only once the capture threads have finished, so the mixer's
    /// last pass drains everything they managed to hand over.
    mixing: Arc<AtomicBool>,
    mixer: Option<JoinHandle<Result<()>>>,
    sources: Vec<Source>,
    path: PathBuf,
    started: Instant,
    /// Peak level of the last mixed block, as a percentage, for the meter.
    level: Arc<AtomicU32>,
    /// Samples written so far, so elapsed time reflects the actual recording.
    written: Arc<AtomicU64>,
}

impl Recorder {
    pub fn start(
        path: PathBuf,
        mic_device: Option<String>,
        system_device: Option<String>,
    ) -> Result<Self> {
        if mic_device.is_none() && system_device.is_none() {
            return Err(anyhow!(
                "Nothing to record: turn on the microphone or the system audio in Settings."
            ));
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).context("Could not create the recordings folder")?;
        }

        let running = Arc::new(AtomicBool::new(true));
        let mut sources = Vec::new();

        for (label, id, loopback) in [
            ("microphone", mic_device, false),
            ("system audio", system_device, true),
        ] {
            let Some(id) = id else { continue };
            let queue = Arc::new(Mutex::new(VecDeque::<f32>::new()));
            let error = Arc::new(Mutex::new(None));
            let heard = Arc::new(AtomicBool::new(false));
            let handle = thread::Builder::new()
                .name(format!("omni-capture-{label}"))
                .spawn({
                    let (queue, running, error, heard) =
                        (queue.clone(), running.clone(), error.clone(), heard.clone());
                    move || capture_thread(id, loopback, queue, running, error, heard)
                })?;
            sources.push(Source {
                label,
                queue,
                error,
                heard,
                handle: Some(handle),
            });
        }

        let level = Arc::new(AtomicU32::new(0));
        let written = Arc::new(AtomicU64::new(0));
        let mixing = Arc::new(AtomicBool::new(true));
        let queues: Vec<Arc<Mutex<VecDeque<f32>>>> =
            sources.iter().map(|s| s.queue.clone()).collect();

        let mixer = thread::Builder::new().name("omni-mixer".into()).spawn({
            let (mixing, path, level, written) =
                (mixing.clone(), path.clone(), level.clone(), written.clone());
            move || mix_loop(path, queues, mixing, level, written)
        })?;

        Ok(Self {
            running,
            mixing,
            mixer: Some(mixer),
            sources,
            path,
            started: Instant::now(),
            level,
            written,
        })
    }

    pub fn seconds(&self) -> f64 {
        self.written.load(Ordering::Relaxed) as f64 / RATE as f64
    }

    pub fn level(&self) -> u32 {
        self.level.load(Ordering::Relaxed)
    }

    /// A source that failed to open at all, reported so the UI can say which
    /// half of the recording is missing rather than silently capturing one.
    pub fn first_error(&self) -> Option<String> {
        for source in &self.sources {
            if let Some(e) = source.error.lock().unwrap().clone() {
                return Some(format!("Could not capture the {}: {e}", source.label));
            }
        }
        None
    }

    pub fn stop(mut self) -> Result<Recording> {
        self.running.store(false, Ordering::Relaxed);
        for source in &mut self.sources {
            if let Some(h) = source.handle.take() {
                let _ = h.join();
            }
        }
        // Only now: with the devices closed, nothing more can arrive, so the
        // mixer's final drain really is final.
        self.mixing.store(false, Ordering::Relaxed);
        if let Some(mixer) = self.mixer.take() {
            mixer
                .join()
                .map_err(|_| anyhow!("The mixer thread stopped unexpectedly"))??;
        }
        let heard_mic = self
            .sources
            .iter()
            .find(|s| s.label == "microphone")
            .is_some_and(|s| s.heard.load(Ordering::Relaxed));
        let heard_system = self
            .sources
            .iter()
            .find(|s| s.label == "system audio")
            .is_some_and(|s| s.heard.load(Ordering::Relaxed));

        Ok(Recording {
            path: self.path.clone(),
            seconds: self.started.elapsed().as_secs_f64(),
            heard_mic,
            heard_system,
        })
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        self.mixing.store(false, Ordering::Relaxed);
    }
}

/// Sum the sources onto a wall-clock timeline and encode as we go.
///
/// Encoding during the recording rather than afterwards is deliberate: a
/// two-hour meeting as 48 kHz WAV is about 700 MB, which has to be uploaded in
/// 40 MB parts and then held in memory server-side while it is reassembled.
/// As MP3 the same meeting is about 60 MB.
fn mix_loop(
    path: PathBuf,
    queues: Vec<Arc<Mutex<VecDeque<f32>>>>,
    mixing: Arc<AtomicBool>,
    level: Arc<AtomicU32>,
    written: Arc<AtomicU64>,
) -> Result<()> {
    let mut encoder = Builder::new().ok_or_else(|| anyhow!("Could not start the MP3 encoder"))?;
    encoder
        .set_num_channels(1)
        .map_err(|e| anyhow!("MP3 channels: {e}"))?;
    encoder
        .set_sample_rate(RATE as u32)
        .map_err(|e| anyhow!("MP3 sample rate: {e}"))?;
    // Speech, mono. Higher bitrates buy nothing a transcript can use and cost
    // upload time on a connection that may be a hotel wifi.
    encoder
        .set_brate(mp3lame_encoder::Bitrate::Kbps64)
        .map_err(|e| anyhow!("MP3 bitrate: {e}"))?;
    encoder
        .set_quality(mp3lame_encoder::Quality::Good)
        .map_err(|e| anyhow!("MP3 quality: {e}"))?;
    let mut encoder = encoder
        .build()
        .map_err(|e| anyhow!("Could not start the MP3 encoder: {e}"))?;

    let mut file = BufWriter::new(File::create(&path).context("Could not open the recording")?);
    let started = Instant::now();
    let mut done: u64 = 0;
    let mut block: Vec<f32> = Vec::with_capacity(RATE);
    let mut mp3: Vec<u8> = Vec::new();

    loop {
        let still_running = mixing.load(Ordering::Relaxed);
        thread::sleep(TICK);

        // How many samples the timeline says should exist by now.
        let target = (started.elapsed().as_secs_f64() * RATE as f64) as u64;
        let need = target.saturating_sub(done) as usize;
        if need > 0 {
            block.clear();
            block.resize(need, 0.0);
            for queue in &queues {
                let mut q = queue.lock().unwrap();
                let take = need.min(q.len());
                for (i, sample) in q.drain(..take).enumerate() {
                    block[i] += sample;
                }
            }

            let mut peak = 0.0f32;
            for sample in block.iter_mut() {
                // Two sources summed can exceed full scale. Clamping is
                // honest distortion at the peaks; scaling the whole recording
                // down to accommodate them would quieten the entire meeting.
                *sample = sample.clamp(-1.0, 1.0);
                peak = peak.max(sample.abs());
            }
            level.store((peak * 100.0) as u32, Ordering::Relaxed);

            encode_block(&mut encoder, &block, &mut mp3)?;
            file.write_all(&mp3)?;
            // Flushed every tick, not just at the end. The recording is the
            // only copy of the meeting, and a buffer that dies with the
            // process would take the last several seconds of it along. MP3 is
            // a stream of independent frames, so what reaches the disk stays
            // playable and transcribable even if nothing else follows it.
            file.flush()?;
            done = target;
            written.store(done, Ordering::Relaxed);
        }

        if !still_running {
            break;
        }
    }

    // Whatever the devices handed over in their last moments.
    let mut tail: Vec<f32> = Vec::new();
    for queue in &queues {
        let mut q = queue.lock().unwrap();
        let leftover: Vec<f32> = q.drain(..).collect();
        if leftover.len() > tail.len() {
            tail.resize(leftover.len(), 0.0);
        }
        for (i, sample) in leftover.into_iter().enumerate() {
            tail[i] += sample;
        }
    }
    if !tail.is_empty() {
        for sample in tail.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
        encode_block(&mut encoder, &tail, &mut mp3)?;
        file.write_all(&mp3)?;
        written.store(done + tail.len() as u64, Ordering::Relaxed);
    }

    let mut flushed = Vec::new();
    flushed.reserve(mp3lame_encoder::max_required_buffer_size(1));
    let size = encoder
        .flush::<FlushNoGap>(flushed.spare_capacity_mut())
        .map_err(|e| anyhow!("Could not finish the MP3: {e}"))?;
    unsafe { flushed.set_len(size) };
    file.write_all(&flushed)?;
    file.flush()?;
    Ok(())
}

fn encode_block(
    encoder: &mut mp3lame_encoder::Encoder,
    block: &[f32],
    out: &mut Vec<u8>,
) -> Result<()> {
    out.clear();
    out.reserve(mp3lame_encoder::max_required_buffer_size(block.len()));
    let size = encoder
        .encode(MonoPcm(block), out.spare_capacity_mut())
        .map_err(|e| anyhow!("Could not encode the audio: {e}"))?;
    unsafe { out.set_len(size) };
    Ok(())
}
