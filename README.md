# Omni — Medical Affairs toolkit for MSLs

An all-in-one workspace for Medical Science Liaisons. Phase 1 ships the app
shell, username/password auth, and the first feature — **Interview Prep**:
upload a recording → transcribe the whole thing → get a nested-bullet summary.

Planned modules: Insights, Meeting Prep, Conference Planning & Execution,
Territory Planning (stubbed for now).

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4
- Supabase — Postgres, Auth, Storage (`@supabase/ssr` + `@supabase/supabase-js`)
- OpenAI — Whisper (transcription) + GPT (summarization)
- `ffmpeg-static` — server-side audio chunking (no system ffmpeg needed)

## Setup
1. Install deps:
   ```bash
   npm install
   ```
2. Fill in `.env.local` (copy from `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — already set.
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard → Settings → API.
   - `OPENAI_API_KEY` — required for transcription + summary.
3. Apply the database schema: open `supabase/migrations/0001_init.sql` and run it
   in the Supabase SQL editor (creates tables, RLS, and the private `recordings`
   storage bucket). No DB password needed for that path.
4. Run it:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 → register a username + password → start in
   Interview Prep.

## How Interview Prep works (3 decoupled stages)
A single `recordings` row tracks the whole job via its `status`, so work is
pollable and resumable.

1. **Upload** — `POST /api/recordings/sign-upload` creates the row and returns a
   Supabase signed upload URL; the client PUTs the file straight to storage via
   `XMLHttpRequest` (live progress). `status: uploading`.
2. **Chunk + transcribe** — `POST /api/recordings/[id]/uploaded` downloads the
   audio and uses `ffmpeg-static` to cut 3-min mono/16 kHz wav chunks. A Web
   Worker (`src/workers/transcribe.worker.ts`) then loops
   `POST /api/recordings/[id]/transcribe-chunk` one chunk at a time — each call
   re-reads the transcript, appends Whisper's output, increments `chunks_done`,
   and deletes the chunk. Progress (`chunks_done/total_chunks`) survives reloads;
   the detail page resumes the loop on mount. `status: transcribing`.
3. **Nested summary** — `POST /api/recordings/[id]/summarize` sends the full
   transcript to GPT (low temperature, "only what was said") and parses the
   indented bullet output into a parent/child tree in `summary_nodes`. The
   original audio is deleted. `status: summarizing → complete`.

## Notes / future work
- The chunking route runs ffmpeg and can be long-running — fine under
  `next dev`/`next start` (Node server). A serverless/Vercel deploy would need a
  dedicated long-running worker for that stage.
- Stage 4 (rolling several recordings + typed notes into one session-level
  summary) is planned, not yet built.
