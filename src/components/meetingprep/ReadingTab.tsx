"use client";

// Reading: what to read before the meeting, and what each piece actually says.
//
// The brief's research is notes for another prompt to write from, with the
// links taken out. This is for the writer: the subject in brief, real pieces
// they can open with the figures and positions in each pulled out, and what
// about the subject is still unsettled. They steer it: find more (with a
// reason), turn a source down (with a reason, which every later search
// obeys), or add their own.

import { useRef, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ThumbsDown,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Working } from "@/components/ui/Progress";
import { SourceQuestions } from "./SourceQuestions";
import { FullPiece } from "./FullPiece";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Feedback";
import {
  setupFingerprint,
  unsettledHeading,
  type MpMeeting,
  type Reading,
  type ReadingSource,
} from "@/lib/meetingprep/types";
import {
  meetingPayload,
  newId,
  removeMaterial,
  type GetMeeting,
  type SaveMeeting,
} from "@/lib/meetingprep/material";

type Found = Omit<ReadingSource, "id" | "kind" | "docId">;
interface ReadingResponse {
  overview: string;
  sources: Found[];
  unsettled: { point: string; sides: { position: string; who: string }[] }[];
}

const REASONS = ["Too old", "Too general", "Not credible enough", "Off topic", "Already know it"];

export function ReadingTab({
  m,
  save,
  getMeeting,
  onAddSource,
}: {
  m: MpMeeting;
  save: SaveMeeting;
  getMeeting: GetMeeting;
  onAddSource: () => void;
}) {
  const toast = useToast();
  const reading: Reading = m.reading || {};
  const sources = reading.sources || [];
  const frame = unsettledHeading(m.meeting_type);
  const [busy, setBusy] = useState<"" | "build" | "more" | string>("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [steerOpen, setSteerOpen] = useState(false);
  const busyRef = useRef(false);

  const stale = Boolean(reading.at && reading.fingerprint && reading.fingerprint !== setupFingerprint(m));
  const built = Boolean(reading.at);

  async function call(body: Record<string, unknown>): Promise<ReadingResponse> {
    const now = getMeeting() || m;
    const r: Reading = now.reading || {};
    const res = await fetch("/api/meeting/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "reading",
        meeting: meetingPayload(now),
        kolId: now.kol_id || "",
        frame,
        steer: r.steer || "",
        existing: (r.sources || []).map((s) => ({ title: s.title, url: s.url, outlet: s.outlet })),
        rejected: r.rejected || [],
        ...body,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "The search failed");
    return json as ReadingResponse;
  }

  const stamp = (s: Found): ReadingSource => ({ ...s, id: newId("r"), kind: "found" });

  async function build() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("build");
    try {
      // A rebuild replaces what the search found, never what the writer
      // added or the sources they turned down.
      const out = await call({ existing: [], more: false });
      const now = getMeeting() || m;
      const r: Reading = now.reading || {};
      const yours = (r.sources || []).filter((s) => s.kind === "yours");
      if (!out.sources.length && !out.overview)
        throw new Error("The search came back empty. Try again in a minute.");
      save({
        reading: {
          ...r,
          overview: out.overview,
          sources: [...yours, ...out.sources.map(stamp)],
          unsettled: out.unsettled.map((u) => ({ ...u, id: newId("u") })),
          at: new Date().toISOString(),
          fingerprint: setupFingerprint(now),
        },
      });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function findMore(request: string, count = 4, replacing?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(replacing || "more");
    try {
      const out = await call({ more: true, ask: request, count });
      const now = getMeeting() || m;
      const r: Reading = now.reading || {};
      if (!out.sources.length) {
        toast("info", "Nothing new turned up for that. Try putting it another way.");
        return;
      }
      const added = out.sources.map(stamp);
      save({
        reading: {
          ...r,
          sources: [...(r.sources || []), ...added],
          // A replacement for one card is not a batch to judge; a search is.
          ...(replacing ? {} : { lastFound: { ids: added.map((x) => x.id), ask: request } }),
        },
      });
      toast("success", `Added ${out.sources.length} ${out.sources.length === 1 ? "source" : "sources"}.`);
      setAsk("");
      setMoreOpen(false);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  function reject(s: ReadingSource, reason: string, replace: boolean) {
    const now = getMeeting() || m;
    const r: Reading = now.reading || {};
    save({
      reading: {
        ...r,
        sources: (r.sources || []).filter((x) => x.id !== s.id),
        rejected: [...(r.rejected || []), { title: s.title, url: s.url, reason }],
      },
    });
    if (replace)
      void findMore(
        `A replacement for "${s.title}", which the writer turned down: "${reason || "not useful"}".`,
        1,
        s.id,
      );
  }

  /**
   * "Not what I wanted" about the whole last search: those sources come off,
   * kept out of later searches with the reason, and the search runs again
   * with the feedback added to what was asked.
   */
  function searchAgain(feedback: string) {
    const now = getMeeting() || m;
    const r: Reading = now.reading || {};
    const ids = new Set(r.lastFound?.ids || []);
    const gone = (r.sources || []).filter((x) => ids.has(x.id));
    const reason = feedback.trim() || "not what I was looking for";
    save({
      reading: {
        ...r,
        sources: (r.sources || []).filter((x) => !ids.has(x.id)),
        rejected: [...(r.rejected || []), ...gone.map((x) => ({ title: x.title, url: x.url, reason }))],
        lastFound: undefined,
      },
    });
    const asked = r.lastFound?.ask || "";
    void findMore(
      [asked && `First asked for: ${asked}`, `The last results were not it. The writer says: ${reason}`]
        .filter(Boolean)
        .join("\n"),
    );
  }

  function clearLastFound() {
    const now = getMeeting() || m;
    save({ reading: { ...(now.reading || {}), lastFound: undefined } });
  }

  function setSteer(steer: string) {
    const now = getMeeting() || m;
    save({ reading: { ...(now.reading || {}), steer } });
  }

  const justFound = new Set(
    (reading.lastFound?.ids || []).filter((id) => sources.some((s) => s.id === id)),
  );
  const must = sources.filter((s) => s.priority === "must");
  const skim = sources.filter((s) => s.priority !== "must");

  if (!built && !sources.length)
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <BookOpen size={26} className="mx-auto text-[var(--accent)]" />
        <div>
          <h2 className="text-base font-semibold">What to read before this meeting</h2>
          <p className="mt-1 text-sm text-muted">
            The subject in brief, the pieces worth reading with the figures and opinions in each
            pulled out, and {frame.title.toLowerCase()}. Built from a web search on{" "}
            {m.topic ? <span className="font-medium text-ink">{m.topic}</span> : "what this meeting is about"}.
          </p>
        </div>
        <SteerBox value={reading.steer || ""} onChange={setSteer} open />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => void build()} disabled={Boolean(busy)}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {busy ? "Searching…" : "Build the reading list"}
          </Button>
          <Button variant="secondary" onClick={onAddSource}>
            <Plus size={15} /> Add your own
          </Button>
        </div>
        {/* Measured: a full list ran 72-87s on the writer's panel. */}
        <Working active={busy === "build"} seconds={120} label="Searching and reading every source" className="text-left" />
      </div>
    );

  return (
    <div className="space-y-5">
      {stale && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="min-w-0 flex-1">
            The meeting has changed since this was built. Rebuild it to match? Your own sources and the
            ones you turned down are kept.
          </p>
          <Button size="sm" onClick={() => void build()} disabled={Boolean(busy)}>
            Rebuild
          </Button>
        </div>
      )}

      {/* One row of controls. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setMoreOpen((v) => !v)} disabled={Boolean(busy)}>
          {busy === "more" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {busy === "more" ? "Searching…" : "Find more"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onAddSource}>
          <Plus size={14} /> Add a source
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void build()} disabled={Boolean(busy)}>
          {busy === "build" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {busy === "build" ? "Rebuilding…" : "Rebuild"}
        </Button>
        <button
          type="button"
          onClick={() => setSteerOpen((v) => !v)}
          className="ml-auto max-w-full truncate text-xs text-muted hover:text-ink"
          title={reading.steer || ""}
        >
          {reading.steer ? (
            <>
              Sources you want: <span className="text-ink">{reading.steer}</span>
            </>
          ) : (
            "Say what sources you want"
          )}
        </button>
      </div>

      {/* Measured on the panel: a full list 72-87s, find more 14-34s. */}
      {/* Search, then open and read every piece in full. */}
      <Working active={busy === "build"} seconds={120} label="Searching and reading every source" />
      <Working active={busy === "more"} seconds={55} label="Searching and reading the new ones" />
      <Working
        active={Boolean(busy) && busy !== "build" && busy !== "more"}
        seconds={25}
        label="Finding a replacement"
      />

      {steerOpen && <SteerBox value={reading.steer || ""} onChange={setSteer} open />}

      {moreOpen && (
        <form
          className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void findMore(ask);
          }}
        >
          <Input
            autoFocus
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder='Anything in particular? e.g. "hard outcome data", "what payers think", "the case against"'
            className="min-w-64 flex-1"
          />
          <Button type="submit" disabled={Boolean(busy)}>
            {busy === "more" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Search
          </Button>
        </form>
      )}

      {justFound.size > 0 && (
        <JustFound
          titles={sources.filter((s) => justFound.has(s.id)).map((s) => s.title)}
          ask={reading.lastFound?.ask || ""}
          busy={Boolean(busy)}
          onAgain={searchAgain}
          onGood={clearLastFound}
        />
      )}

      {reading.overview && (
        <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <BookOpen size={15} className="text-[var(--accent)]" /> The topic in brief
          </h2>
          <div className="space-y-2 text-sm leading-relaxed text-ink">
            {reading.overview.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      )}

      {must.length > 0 && (
        <SourceGroup
          title="Read before you go"
          items={must}
          busy={busy}
          fresh={justFound}
          getMeeting={getMeeting}
          save={save}
          onReject={reject}
          onRemove={(s) => (s.docId ? removeMaterial(s.docId, getMeeting, save) : reject(s, "", false))}
        />
      )}
      {skim.length > 0 && (
        <SourceGroup
          title="Worth a skim"
          items={skim}
          busy={busy}
          fresh={justFound}
          getMeeting={getMeeting}
          save={save}
          onReject={reject}
          onRemove={(s) => reject(s, "", false)}
        />
      )}

      {(reading.unsettled || []).length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Scale size={15} className="text-[var(--accent)]" /> {frame.title}
          </h2>
          <p className="mb-3 text-xs text-muted">{frame.hint}</p>
          <ul className="space-y-4">
            {(reading.unsettled || []).map((u) => (
              <li key={u.id}>
                <p className="text-sm font-medium">{u.point}</p>
                <ul className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3">
                  {u.sides.map((s, i) => (
                    <li key={i} className="text-sm">
                      {s.position}
                      {s.who && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          <UserRound size={11} /> {s.who}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reading.at && (
        <p className="text-[11px] text-muted">
          Searched {new Date(reading.at).toLocaleDateString()}. Links are only ones the search actually
          returned.
          {(reading.rejected || []).length > 0 &&
            ` ${reading.rejected!.length} turned down, and kept out of every search.`}
        </p>
      )}
    </div>
  );
}

function SteerBox({ value, onChange, open }: { value: string; onChange: (v: string) => void; open: boolean }) {
  const [draft, setDraft] = useState(value);
  if (!open) return null;
  return (
    <div className="text-left">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value && onChange(draft.trim())}
        placeholder='What sources do you want? e.g. "peer-reviewed and survey data, not consultancy blogs"'
      />
      <p className="mt-1 text-[11px] text-muted">Every search for this meeting follows this. Optional.</p>
    </div>
  );
}

function SourceGroup({
  title,
  items,
  busy,
  fresh,
  getMeeting,
  save,
  onReject,
  onRemove,
}: {
  title: string;
  items: ReadingSource[];
  busy: string;
  fresh: Set<string>;
  getMeeting: GetMeeting;
  save: SaveMeeting;
  onReject: (s: ReadingSource, reason: string, replace: boolean) => void;
  onRemove: (s: ReadingSource) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <ul className="space-y-3">
        {items.map((s) => (
          <SourceCard
            key={s.id}
            s={s}
            busy={busy}
            isNew={fresh.has(s.id)}
            getMeeting={getMeeting}
            save={save}
            onReject={onReject}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  );
}

function SourceCard({
  s,
  busy,
  isNew = false,
  getMeeting,
  save,
  onReject,
  onRemove,
}: {
  s: ReadingSource;
  busy: string;
  isNew?: boolean;
  getMeeting: GetMeeting;
  save: SaveMeeting;
  onReject: (s: ReadingSource, reason: string, replace: boolean) => void;
  onRemove: (s: ReadingSource) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const meta = [s.outlet, s.date].filter(Boolean).join(" · ");

  return (
    <li className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-start gap-1 text-sm font-semibold text-ink hover:text-[var(--accent)]"
            >
              <span>{s.title}</span>
              <ExternalLink size={12} className="mt-1 shrink-0 text-muted group-hover:text-[var(--accent)]" />
            </a>
          ) : (
            <p className="text-sm font-semibold">{s.title}</p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {meta}
            {isNew && (
              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                Just found
              </span>
            )}
            {s.kind === "yours" && (
              <span className="ml-1.5 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                You added this
              </span>
            )}
          </p>
        </div>
        {s.kind === "yours" ? (
          <button
            type="button"
            onClick={() => onRemove(s)}
            className="shrink-0 rounded p-1 text-muted hover:text-red-600"
            title="Remove it"
            aria-label="Remove it"
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRejecting((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:text-ink"
          >
            <ThumbsDown size={13} /> Not useful
          </button>
        )}
      </div>
      {/* Right under the button. At the foot of the card it opened below the
          whole list of drafted questions, off-screen, and the click looked dead. */}
      {rejecting && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-canvas p-3">
          <p className="text-xs font-medium">What&apos;s wrong with it? Later searches will avoid the same thing.</p>
          <p className="text-[11px] text-muted">Questions from it already in your list or bank stay where they are.</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  reason === r ? "border-[var(--accent)] text-[var(--accent)]" : "border-border text-muted hover:text-ink"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or say it in your words" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onReject(s, reason.trim(), false)}>
              Just remove it
            </Button>
            <Button size="sm" onClick={() => onReject(s, reason.trim(), true)} disabled={Boolean(busy)}>
              Replace it
            </Button>
          </div>
        </div>
      )}

      {s.summary && <p className="mt-2 text-sm leading-relaxed">{s.summary}</p>}
      {s.kind === "found" && s.read !== "full" && (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <p>
            I couldn&apos;t open the full piece (a paywall or a login, usually), so this is only from
            what the search showed of it. Add the article and I&apos;ll read the whole thing.
          </p>
          <FullPiece s={s} getMeeting={getMeeting} save={save} />
        </div>
      )}
      {s.findings.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            What it says{s.read === "full" ? " (read in full)" : ""}
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {s.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {s.why && <p className="mt-2 text-xs italic text-muted">Why read it: {s.why}</p>}
      <SourceQuestions s={s} getMeeting={getMeeting} save={save} />

      {busy === s.id && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Finding a replacement…
        </p>
      )}

    </li>
  );
}

/** What the last search found, and the chance to say it missed. */
function JustFound({
  titles,
  ask,
  busy,
  onAgain,
  onGood,
}: {
  titles: string[];
  ask: string;
  busy: boolean;
  onAgain: (feedback: string) => void;
  onGood: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  return (
    <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm">
      <p>
        <span className="font-semibold">Just found {titles.length}</span>
        {ask ? <span className="text-muted"> for &ldquo;{ask}&rdquo;</span> : null}:{" "}
        <span className="text-ink/80">{titles.join(" · ")}</span>
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onAgain(feedback);
        }}
      >
        <Input
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder='Not what you wanted? Say what is missing, e.g. "I wanted payer views, not more surveys"'
          className="min-w-64 flex-1"
        />
        <Button type="submit" size="sm" disabled={busy}>
          <Search size={13} /> Search again
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onGood}>
          These are fine
        </Button>
      </form>
      <p className="text-[11px] text-muted">
        Searching again takes these off the list and keeps them out of later searches.
      </p>
    </section>
  );
}
