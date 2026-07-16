"use client";

// Crash-safe local persistence for in-progress recordings. MediaRecorder
// hands us a data chunk every few seconds; each chunk is written straight to
// IndexedDB, so a crashed tab / dead battery / closed PWA loses at most the
// last few seconds. Chunks of one segment concatenated in order form a valid
// webm file (the first chunk carries the container header), so recovery can
// feed the stored segments straight back into the transcription pipeline.

const DB_NAME = "omni-recording-vault";
const STORE = "chunks";

interface ChunkRow {
  key: string; // vault session key, e.g. conf-<confId>-<eventId>
  segment: number;
  chunk: number;
  mime: string;
  blob: Blob;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: ["key", "segment", "chunk"],
        });
        store.createIndex("byKey", "key");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveChunk(
  key: string,
  segment: number,
  chunk: number,
  blob: Blob,
  mime: string,
): Promise<void> {
  try {
    await withStore("readwrite", (store) => {
      store.put({ key, segment, chunk, mime, blob, savedAt: Date.now() } satisfies ChunkRow);
    });
  } catch {
    // Vault is best-effort — never let persistence break a live recording.
  }
}

export interface VaultSession {
  key: string;
  segments: Blob[]; // one standalone webm per segment, in order
  approxSeconds: number;
  savedAt: number;
}

// All chunks for a key, reassembled into per-segment blobs.
export async function loadSession(key: string): Promise<VaultSession | null> {
  try {
    const rows =
      (await withStore<ChunkRow[]>("readonly", (store) =>
        store.index("byKey").getAll(key),
      )) || [];
    if (!rows.length) return null;
    rows.sort((a, b) => a.segment - b.segment || a.chunk - b.chunk);
    const bySegment = new Map<number, ChunkRow[]>();
    for (const r of rows) {
      bySegment.set(r.segment, [...(bySegment.get(r.segment) || []), r]);
    }
    const segments = [...bySegment.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, chunks]) =>
        new Blob(chunks.map((c) => c.blob), { type: chunks[0].mime || "audio/webm" }),
      )
      .filter((b) => b.size > 0);
    if (!segments.length) return null;
    // MediaRecorder timeslice is ~5s per chunk — good enough for a label.
    return {
      key,
      segments,
      approxSeconds: rows.length * 5,
      savedAt: Math.max(...rows.map((r) => r.savedAt)),
    };
  } catch {
    return null;
  }
}

export async function clearSession(key: string): Promise<void> {
  try {
    const rows =
      (await withStore<ChunkRow[]>("readonly", (store) =>
        store.index("byKey").getAll(key),
      )) || [];
    await withStore("readwrite", (store) => {
      for (const r of rows) store.delete([r.key, r.segment, r.chunk]);
    });
  } catch {
    // best-effort
  }
}
