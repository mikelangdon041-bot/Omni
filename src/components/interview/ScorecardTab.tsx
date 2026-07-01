"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Check, UserPlus, Trash2 } from "lucide-react";
import {
  SCORECARD_COMPETENCIES,
  RATING_MAX,
  ratingLabel,
  RECOMMENDATIONS,
  RECOMMENDATION_COLOR,
  RECOMMENDATION_LABEL,
  type FeedbackRating,
  type InterviewFeedback,
} from "@/lib/interview/types";
import { useInterviewFeedback } from "@/lib/interview/hooks";
import { cn } from "@/lib/ui";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

export function ScorecardTab({
  candidateId,
  userId,
  isOwner,
}: {
  candidateId: string;
  userId: string | null;
  isOwner: boolean;
}) {
  const { mine, others, loading, save, submit } = useInterviewFeedback(
    candidateId,
    userId,
  );

  return (
    <div className="space-y-6">
      {isOwner && <Interviewers candidateId={candidateId} />}

      <MyScorecard
        key={mine?.id || "new"}
        mine={mine}
        save={save}
        submit={submit}
      />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">
          Other interviewers
        </h3>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        ) : !mine?.submitted ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-5 py-6 text-sm text-muted">
            <Lock size={15} /> Submit your own scorecard to unlock other
            interviewers&apos; feedback (keeps opinions unbiased).
          </div>
        ) : others.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-6 text-center text-sm text-muted">
            No other submitted scorecards yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {others.map((f) => (
              <SubmittedCard key={f.id} f={f} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---- My scorecard -------------------------------------------------
function MyScorecard({
  mine,
  save,
  submit,
}: {
  mine: InterviewFeedback | null;
  save: (p: Partial<InterviewFeedback>) => Promise<void>;
  submit: (p: Partial<InterviewFeedback>) => Promise<void>;
}) {
  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    (mine?.ratings || []).forEach((r) => (m[r.competency] = r.rating));
    return m;
  });
  const [recommendation, setRecommendation] = useState(mine?.recommendation || "");
  const [notes, setNotes] = useState(mine?.notes || "");
  const [busy, setBusy] = useState(false);

  const payload = (): Partial<InterviewFeedback> => ({
    ratings: SCORECARD_COMPETENCIES.filter((c) => ratings[c]).map((c) => ({
      competency: c,
      rating: ratings[c],
    })) as FeedbackRating[],
    recommendation: (recommendation || null) as InterviewFeedback["recommendation"],
    notes,
  });

  async function doSave(isSubmit: boolean) {
    setBusy(true);
    if (isSubmit) await submit(payload());
    else await save(payload());
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Your scorecard
        </h3>
        {mine?.submitted && (
          <Badge className="bg-emerald-100 text-emerald-700">
            <Check size={12} /> Submitted
          </Badge>
        )}
      </div>

      <div className="space-y-5">
        {SCORECARD_COMPETENCIES.map((c) => {
          const val = ratings[c] || 0;
          return (
            <div key={c}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{c}</span>
                <span className="text-sm text-muted">
                  {val ? (
                    <>
                      <span className="font-semibold text-ink">{val}</span>
                      <span className="text-muted">/{RATING_MAX}</span>{" "}
                      · {ratingLabel(val)}
                    </>
                  ) : (
                    <span className="text-muted">Not rated</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={RATING_MAX}
                  step={1}
                  value={val || 1}
                  onChange={(e) => setRatings((r) => ({ ...r, [c]: Number(e.target.value) }))}
                  className={cn(
                    "h-2 w-full cursor-pointer appearance-none rounded-full bg-canvas accent-[var(--accent)]",
                    !val && "opacity-60",
                  )}
                  style={
                    val
                      ? {
                          background: `linear-gradient(to right, var(--accent) ${((val - 1) / (RATING_MAX - 1)) * 100}%, var(--color-canvas, #eef0f4) ${((val - 1) / (RATING_MAX - 1)) * 100}%)`,
                        }
                      : undefined
                  }
                />
                <span className="w-6 shrink-0 text-right text-sm font-semibold text-ink">
                  {val || "–"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Overall recommendation"
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}
        >
          <option value="">Choose…</option>
          {RECOMMENDATIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Evidence, strengths, concerns…"
          className="min-h-28 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => doSave(false)} disabled={busy}>
          Save draft
        </Button>
        <Button onClick={() => doSave(true)} disabled={busy}>
          {mine?.submitted ? "Update" : "Submit"}
        </Button>
      </div>
    </div>
  );
}

function SubmittedCard({ f }: { f: InterviewFeedback }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-muted">Interviewer</span>
        {f.recommendation && (
          <Badge className={RECOMMENDATION_COLOR[f.recommendation]}>
            {RECOMMENDATION_LABEL[f.recommendation]}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {f.ratings.map((r) => (
          <span key={r.competency} className="text-muted">
            {r.competency}: <span className="font-medium text-ink">{r.rating}/{RATING_MAX}</span>
          </span>
        ))}
      </div>
      {f.notes && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink/90">{f.notes}</p>
      )}
    </li>
  );
}

// ---- Interviewers (owner only) ------------------------------------
interface Member {
  id: string;
  username: string;
  display_name: string | null;
}
interface Share {
  id: string;
  username: string;
  scope: { role?: string };
}

function Interviewers({ candidateId }: { candidateId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      fetch("/api/org/members", { credentials: "same-origin" }),
      fetch(`/api/interview/share?candidateId=${candidateId}`, { credentials: "same-origin" }),
    ]);
    if (m.ok) setMembers((await m.json()).members || []);
    if (s.ok) setShares((await s.json()).shares || []);
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setError(null);
    if (!username) return;
    setBusy(true);
    const res = await fetch("/api/interview/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ candidateId, username, scope: { role: "interviewer" } }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add");
      return;
    }
    setUsername("");
    await load();
  }

  async function remove(id: string) {
    setShares((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/interview/share?id=${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  }

  const taken = new Set(shares.map((s) => s.username));
  const available = members.filter((m) => !taken.has(m.username));

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <UserPlus size={15} /> Interview panel
      </h3>
      <p className="mb-3 text-sm text-muted">
        Add teammates as interviewers — each fills their own scorecard, hidden
        from the others until they submit.
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-muted">
          No teammates yet. Add members in Admin to build a panel.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={username} onChange={(e) => setUsername(e.target.value)} className="flex-1">
            <option value="">Choose a teammate…</option>
            {available.map((m) => (
              <option key={m.id} value={m.username}>
                {m.display_name || m.username} (@{m.username})
              </option>
            ))}
          </Select>
          <Button onClick={add} disabled={busy}>
            <UserPlus size={15} /> Add
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-status-error">{error}</p>}

      {shares.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {shares.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span>@{s.username}</span>
              <button
                onClick={() => remove(s.id)}
                className="text-muted transition hover:text-status-error"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
