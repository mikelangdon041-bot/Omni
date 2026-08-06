// Driving Omni's existing transcription pipeline from outside the browser.
//
// /api/meeting/transcribe-upload is a set of JSON actions the web app already
// drives from its own upload page: sign a part, upload it, prepare (reassemble
// and split into chunks), transcribe one chunk per request, discard the
// leftovers. Nothing about that is browser-specific, so this app is a second
// client of the same protocol rather than a second pipeline.
//
// Two ceilings shape the upload and both belong to the server, not to us:
// Vercel rejects request bodies past about 4.5 MB, so parts go straight to
// Supabase storage through signed URLs; and Supabase rejects any single object
// over 50 MB, reported as a 400 whose body says 413, so parts are 40 MB.
//
// One chunk per request is what makes meeting length a matter of more
// requests rather than a timeout. The loop lives here for the same reason it
// lives in the browser client: whoever drives it is the one thing not bounded
// by a function's time limit.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeSet;
use std::time::Duration;

/// Comfortably under Supabase's 50 MB per-object limit.
const PART_BYTES: usize = 40 * 1024 * 1024;
/// Chunk requests in flight at once, matching the web client.
const CONCURRENCY: usize = 3;

pub struct Progress {
    /// 0-100 across the whole job.
    pub percent: u32,
    pub label: String,
}

#[derive(Deserialize)]
struct Signed {
    #[serde(rename = "signedUrl")]
    signed_url: String,
}

#[derive(Deserialize)]
struct Prepared {
    #[serde(rename = "totalChunks")]
    total_chunks: usize,
    #[serde(rename = "chunkExt")]
    chunk_ext: String,
    #[serde(default, rename = "audioPath")]
    audio_path: String,
}

#[derive(Deserialize)]
struct Chunk {
    #[serde(default)]
    text: String,
    #[serde(default)]
    speakers: Vec<String>,
}

#[derive(Deserialize)]
pub struct Captured {
    pub id: String,
    pub title: String,
    pub path: String,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    error: Option<String>,
}

pub struct Client {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Client {
    pub fn new(base: &str, token: &str) -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                // Generous: `prepare` runs ffmpeg over the whole recording,
                // and a long meeting legitimately takes minutes.
                .timeout(Duration::from_secs(600))
                .build()
                .context("Could not start the HTTP client")?,
            base: base.trim_end_matches('/').to_string(),
            token: token.to_string(),
        })
    }

    async fn post(&self, path: &str, body: serde_json::Value) -> Result<String> {
        let res = self
            .http
            .post(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .context("Could not reach Omni")?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            let detail = serde_json::from_str::<ApiError>(&text)
                .ok()
                .and_then(|e| e.error)
                .unwrap_or_else(|| format!("Request failed ({status})"));
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(anyhow!(
                    "Omni rejected the sign-in. Open Omni Recorder and sign in again."
                ));
            }
            return Err(anyhow!(detail));
        }
        Ok(text)
    }

    async fn upload(&self, body: serde_json::Value) -> Result<String> {
        self.post("/api/meeting/transcribe-upload", body).await
    }

    /// Upload a recording and return its transcript, driving the whole
    /// sign/prepare/chunk/discard sequence.
    pub async fn transcribe(
        &self,
        audio: &std::path::Path,
        keep_audio: bool,
        on_progress: &(dyn Fn(Progress) + Send + Sync),
    ) -> Result<(String, Vec<String>, String)> {
        let bytes = tokio::fs::read(audio)
            .await
            .context("Could not read the recording")?;
        if bytes.is_empty() {
            return Err(anyhow!("The recording is empty"));
        }
        let upload_id = new_uuid();
        let ext = "mp3";
        let parts = bytes.len().div_ceil(PART_BYTES).max(1);

        // Anything that reached storage but never became a transcript has to
        // go, on the failure paths as well as the happy one.
        let result = self
            .transcribe_inner(&upload_id, ext, &bytes, parts, keep_audio, on_progress)
            .await;
        if result.is_err() {
            let _ = self
                .upload(json!({ "action": "discard", "uploadId": upload_id }))
                .await;
        }
        result
    }

    async fn transcribe_inner(
        &self,
        upload_id: &str,
        ext: &str,
        bytes: &[u8],
        parts: usize,
        keep_audio: bool,
        on_progress: &(dyn Fn(Progress) + Send + Sync),
    ) -> Result<(String, Vec<String>, String)> {
        // --- 1. Upload the recording in parts ------------------------------
        const UPLOAD_SHARE: u32 = 20;
        const PREPARE_SHARE: u32 = 15;

        on_progress(Progress { percent: 0, label: "Uploading".into() });
        for i in 0..parts {
            let signed: Signed = serde_json::from_str(
                &self
                    .upload(json!({
                        "action": "sign",
                        "uploadId": upload_id,
                        "part": i,
                        "ext": ext,
                    }))
                    .await?,
            )
            .context("Omni sent an unexpected reply while starting the upload")?;

            let start = i * PART_BYTES;
            let end = ((i + 1) * PART_BYTES).min(bytes.len());
            let res = self
                .http
                .put(&signed.signed_url)
                .header("Content-Type", "audio/mpeg")
                .body(bytes[start..end].to_vec())
                .send()
                .await
                .context("Could not upload the recording")?;
            if !res.status().is_success() {
                let status = res.status();
                let detail = res.text().await.unwrap_or_default();
                return Err(anyhow!(
                    "Upload failed ({status}){}",
                    if detail.is_empty() { String::new() } else { format!(": {}", &detail[..detail.len().min(200)]) }
                ));
            }
            on_progress(Progress {
                percent: ((end as f64 / bytes.len() as f64) * UPLOAD_SHARE as f64) as u32,
                label: "Uploading".into(),
            });
        }

        // --- 2. Reassemble and split ---------------------------------------
        on_progress(Progress {
            percent: UPLOAD_SHARE,
            label: "Preparing the audio".into(),
        });
        let prepared: Prepared = serde_json::from_str(
            &self
                .upload(json!({
                    "action": "prepare",
                    "uploadId": upload_id,
                    "parts": parts,
                    "ext": ext,
                    "keepAudio": keep_audio,
                }))
                .await?,
        )
        .context("Omni sent an unexpected reply while preparing the audio")?;

        if prepared.total_chunks == 0 {
            return Err(anyhow!("No audio was found in that recording"));
        }

        // --- 3. Transcribe, one chunk per request ---------------------------
        let base = UPLOAD_SHARE + PREPARE_SHARE;
        let span = 100 - base;
        on_progress(Progress { percent: base, label: "Transcribing".into() });

        let mut texts: Vec<String> = vec![String::new(); prepared.total_chunks];
        let mut speakers: BTreeSet<String> = BTreeSet::new();
        let mut done = 0usize;

        // The first chunk runs alone: it works out who is speaking and stores
        // a voice sample per person, and every later chunk is handed those
        // samples so one person keeps one label. Running them all at once
        // would race that, and speakers would drift mid-meeting.
        let first = self
            .transcribe_chunk(upload_id, 0, &prepared.chunk_ext)
            .await?;
        texts[0] = first.text;
        speakers.extend(first.speakers);
        done += 1;
        on_progress(Progress {
            percent: base + (done as f64 / prepared.total_chunks as f64 * span as f64) as u32,
            label: "Transcribing".into(),
        });

        let mut index = 1usize;
        while index < prepared.total_chunks {
            let batch: Vec<usize> = (index..prepared.total_chunks)
                .take(CONCURRENCY)
                .collect();
            index += batch.len();

            let results = futures_util::future::join_all(
                batch
                    .iter()
                    .map(|i| self.transcribe_chunk(upload_id, *i, &prepared.chunk_ext)),
            )
            .await;

            for (i, result) in batch.iter().zip(results) {
                let chunk = result?;
                texts[*i] = chunk.text;
                speakers.extend(chunk.speakers);
                done += 1;
            }
            on_progress(Progress {
                percent: base + (done as f64 / prepared.total_chunks as f64 * span as f64) as u32,
                label: "Transcribing".into(),
            });
        }

        // Each chunk was removed as it was read; this clears anything left.
        let _ = self
            .upload(json!({ "action": "discard", "uploadId": upload_id }))
            .await;

        let transcript = texts
            .into_iter()
            .filter(|t| !t.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");

        Ok((transcript, speakers.into_iter().collect(), prepared.audio_path))
    }

    /// One chunk, with a couple of retries — a single dropped connection
    /// should not cost the whole recording forty chunks in.
    async fn transcribe_chunk(&self, upload_id: &str, index: usize, ext: &str) -> Result<Chunk> {
        let mut last = None;
        for attempt in 1..=3 {
            let body = json!({
                "action": "chunk",
                "uploadId": upload_id,
                "index": index,
                "chunkExt": ext,
            });
            match self.upload(body).await {
                Ok(text) => {
                    return serde_json::from_str(&text)
                        .context("Omni sent an unexpected reply while transcribing")
                }
                Err(e) => {
                    last = Some(e);
                    if attempt < 3 {
                        tokio::time::sleep(Duration::from_millis(1500 * attempt)).await;
                    }
                }
            }
        }
        Err(last.unwrap_or_else(|| anyhow!("Transcription failed")))
    }

    /// Turn the transcript into a saved meeting and return where it lives.
    /// An empty `title` leaves the naming to the same AI prompt that writes
    /// the notes — the server already treats a blank title that way.
    pub async fn capture(
        &self,
        transcript: &str,
        audio_path: &str,
        keep_audio: bool,
        title: &str,
        onenote_section: &str,
    ) -> Result<Captured> {
        let body = json!({
            "transcript": transcript,
            "audioPath": if keep_audio { audio_path } else { "" },
            "title": title,
            // Empty means "leave them in Omni". The server only reaches for
            // OneNote when it is given somewhere to put them.
            "oneNoteSectionId": onenote_section,
        });
        let text = self.post("/api/meeting/capture", body).await?;
        serde_json::from_str(&text).context("Omni sent an unexpected reply while saving the meeting")
    }

    /// What the destination picker needs: is OneNote connected, which sections
    /// can be written to, and where did the last one go.
    ///
    /// Returned as raw JSON — the window is the only thing that reads it, and
    /// giving it a Rust shape here would mean maintaining the same list twice.
    ///
    /// Not connected is a normal answer, not a failure: most of the time this
    /// runs the answer is "no", and a picker that errored rather than hiding
    /// itself would put a red message in front of someone who never asked for
    /// OneNote in the first place.
    pub async fn onenote_destinations(&self) -> Result<serde_json::Value> {
        let status_text = self
            .post("/api/onenote", json!({ "action": "status" }))
            .await?;
        let status: serde_json::Value = serde_json::from_str(&status_text)
            .context("Omni sent an unexpected reply about OneNote")?;
        if status.get("connected").and_then(|v| v.as_bool()) != Some(true) {
            return Ok(json!({ "connected": false, "sections": [] }));
        }
        let sections_text = self
            .post("/api/onenote", json!({ "action": "sections" }))
            .await?;
        let sections: serde_json::Value = serde_json::from_str(&sections_text)
            .context("Omni sent an unexpected reply about OneNote")?;
        Ok(json!({
            "connected": true,
            "sections": sections.get("sections").cloned().unwrap_or(json!([])),
            "lastSectionId": status.get("lastSectionId").cloned().unwrap_or(json!(null)),
            "lastSectionName": status.get("lastSectionName").cloned().unwrap_or(json!(null)),
        }))
    }
}

/// A v4 UUID, which is the shape the upload id has to take server-side.
fn new_uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Not cryptographic, and does not need to be: the id only has to be
    // unique within one user's storage prefix for the life of one upload.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut state = nanos as u64 ^ (std::process::id() as u64) << 32;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let mut bytes = [0u8; 16];
    for slot in bytes.chunks_mut(8) {
        slot.copy_from_slice(&next().to_le_bytes()[..slot.len()]);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let h: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}
