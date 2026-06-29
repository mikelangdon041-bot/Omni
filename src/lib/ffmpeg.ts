import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// 3 minutes per chunk, normalized to mono 16 kHz wav (small + STT-friendly).
const CHUNK_SECONDS = 180;

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

// Split an audio buffer into ordered mono/16kHz wav chunks.
export async function chunkAudio(
  input: Buffer,
  inputExt = "bin",
): Promise<AudioChunk[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "omni-ffmpeg-"));
  try {
    const inputPath = path.join(dir, `input.${inputExt}`);
    await writeFile(inputPath, input);

    // %03d => chunk_000.wav, chunk_001.wav, ...
    const pattern = path.join(dir, "chunk_%03d.wav");
    await run([
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "segment",
      "-segment_time", String(CHUNK_SECONDS),
      "-reset_timestamps", "1",
      pattern,
    ]);

    const files = (await readdir(dir))
      .filter((f) => /^chunk_\d+\.wav$/.test(f))
      .sort();

    const chunks: AudioChunk[] = [];
    for (let i = 0; i < files.length; i++) {
      const bytes = await readFile(path.join(dir, files[i]));
      chunks.push({ index: i, bytes });
    }
    return chunks;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
