import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// 3 minutes per chunk, normalized to mono 16 kHz mp3.
//
// mp3 rather than wav: at 16 kHz mono, wav is ~32 KB/s and this mp3 setting is
// ~11 KB/s, so every chunk sent to Whisper is roughly a third the size. On a
// long meeting that is the difference between comfortably inside the
// transcription budget and not — and speech recognition is unaffected.
const CHUNK_SECONDS = 180;
const MP3_ARGS = ["-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-q:a", "6"];
// m4a holds an untouched AAC stream, which is what phone recordings and the
// audio track of an mp4/mov almost always are.
const AUDIO_COPY_EXT = "m4a";

const ffmpegPath = (ffmpegStatic as unknown as string) || "ffmpeg";

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export interface AudioChunk {
  index: number;
  bytes: Buffer;
}

// Cut a short clip out of an audio buffer, as mp3.
//
// Used to grab a voice sample per speaker: diarisation labels speakers per
// request, so without a reference sample the same person is "A" in one chunk
// and "B" in the next. Handing the same samples to every chunk is what keeps
// one person one label across a whole meeting.
export async function extractSample(
  input: Buffer,
  inputExt: string,
  startSec: number,
  durationSec: number,
): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "omni-sample-"));
  try {
    const inputPath = path.join(dir, `input.${inputExt}`);
    const outPath = path.join(dir, "sample.mp3");
    await writeFile(inputPath, input);
    await run([
      "-hide_banner",
      "-loglevel", "error",
      "-ss", startSec.toFixed(2),
      "-t", durationSec.toFixed(2),
      "-i", inputPath,
      "-vn",
      ...MP3_ARGS,
      outPath,
    ]);
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface ChunkedAudio {
  chunks: AudioChunk[];
  /** Extension of the produced chunks — "mp3" normally, the source ext on the raw fallback. */
  ext: string;
}

// mp4 and m4a are the same MPEG-4 container, but Whisper handles files
// labelled m4a far more reliably — so if we ever hand it the original bytes,
// hand them over under the extension it copes with.
function whisperExt(ext: string) {
  return ext === "mp4" ? "m4a" : ext;
}

// Split an audio buffer into ordered mono/16 kHz mp3 chunks.
//
// Three levels, because a failed conversion should degrade rather than lose
// the recording outright:
//   1. segment-split to mp3 — the normal path, and the only one that yields
//      real progress reporting;
//   2. convert the whole file to one mp3 — recovers when segmenting trips over
//      a container ffmpeg can read but not cleanly cut;
//   3. send the original bytes untouched — recovers when ffmpeg can't handle
//      the file at all, which Whisper often still can.
export async function chunkAudio(
  input: Buffer,
  inputExt = "bin",
): Promise<ChunkedAudio> {
  const dir = await mkdtemp(path.join(tmpdir(), "omni-ffmpeg-"));
  try {
    const inputPath = path.join(dir, `input.${inputExt}`);
    await writeFile(inputPath, input);

    // 1. Segment split.
    try {
      const pattern = path.join(dir, "chunk_%03d.mp3");
      await run([
        "-hide_banner",
        "-loglevel", "error",
        "-i", inputPath,
        "-vn",
        ...MP3_ARGS,
        "-f", "segment",
        "-segment_time", String(CHUNK_SECONDS),
        "-reset_timestamps", "1",
        pattern,
      ]);

      const files = (await readdir(dir))
        .filter((f) => /^chunk_\d+\.mp3$/.test(f))
        .sort();

      if (files.length > 0) {
        const chunks: AudioChunk[] = [];
        for (let i = 0; i < files.length; i++) {
          chunks.push({ index: i, bytes: await readFile(path.join(dir, files[i])) });
        }
        return { chunks, ext: "mp3" };
      }
    } catch {
      // fall through to the whole-file conversion
    }

    // 2. One mp3 for the whole recording.
    try {
      const outPath = path.join(dir, "whole.mp3");
      await run([
        "-hide_banner",
        "-loglevel", "error",
        "-i", inputPath,
        "-vn",
        ...MP3_ARGS,
        outPath,
      ]);
      return { chunks: [{ index: 0, bytes: await readFile(outPath) }], ext: "mp3" };
    } catch {
      // fall through to a straight audio-stream copy
    }

    // 3. Lift the audio stream out without re-encoding it. Recovers when the
    //    mp3 encoder is the thing that failed, and — the reason it matters
    //    here — still drops the video track. Voice memos transferred off a
    //    phone routinely arrive as .mp4/.mov, and shipping that whole
    //    container to a speech API means paying to upload video nobody wants.
    try {
      const copyPath = path.join(dir, `audio.${AUDIO_COPY_EXT}`);
      await run([
        "-hide_banner",
        "-loglevel", "error",
        "-i", inputPath,
        "-vn",
        "-c:a", "copy",
        copyPath,
      ]);
      return {
        chunks: [{ index: 0, bytes: await readFile(copyPath) }],
        ext: AUDIO_COPY_EXT,
      };
    } catch {
      // fall through to sending the original bytes
    }

    // 4. Untouched. Last resort — ffmpeg couldn't read the file at all, and
    //    Whisper often still can.
    return { chunks: [{ index: 0, bytes: input }], ext: whisperExt(inputExt) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
