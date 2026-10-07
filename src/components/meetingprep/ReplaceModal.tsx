"use client";

// Replace a word or phrase everywhere in a meeting, and optionally keep the
// correction for every meeting after it.
//
// It used to be called Rename and asked "who or what" to "call them", which
// read as a tool for names only. Most of what comes back wrong from a
// recording is not a name: it is a system, a product, an acronym, a place. So
// the wording is about words, and "this was me" stays as the one shortcut that
// is about a person.

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { canRemember, type Spelling } from "@/lib/meetingprep/spellings";

type Props = {
  open: boolean;
  onClose: () => void;
  /** What was selected when the dialog was opened; empty to type it in. */
  initialWhat: string;
  /** "3 in the notes, 1 follow-up", for showing what the replace will touch. */
  describeMatches: (what: string) => string;
  /** The places this replace reaches, as a phrase. */
  where: string;
  spellings: Spelling[];
  onApply: (what: string, to: string, remember: boolean) => void;
  onForget: (wrong: string) => void;
};

export function ReplaceModal(props: Props) {
  // Keyed so every opening is a fresh form: the last replace's words are
  // never what the next one is about.
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={
        props.initialWhat
          ? `Replace “${props.initialWhat.slice(0, 40)}”`
          : "Replace a word"
      }
      size="sm"
    >
      {props.open && <ReplaceForm key={props.initialWhat} {...props} />}
    </Modal>
  );
}

function ReplaceForm({
  onClose,
  initialWhat,
  describeMatches,
  where,
  spellings,
  onApply,
  onForget,
}: Props) {
  const [what, setWhat] = useState(initialWhat);
  const [to, setTo] = useState("");
  const [remember, setRemember] = useState(true);

  const w = what.trim();
  const t = to.trim();
  const rememberable = canRemember(w, t);
  // Taught already, in the other direction or the same: say so rather than
  // leave it looking like nothing will be kept.
  const known = spellings.find(
    (s) => s.wrong.toLowerCase() === w.toLowerCase(),
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (w && t) onApply(w, t, remember && rememberable);
      }}
    >
      <p className="text-sm text-muted">
        Any word or phrase, not only names. Changes every place it appears in
        {` ${where}`}.
      </p>
      {!initialWhat && (
        <Input
          label="Find"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="the word as it came out"
          autoFocus
        />
      )}
      <Input
        label="Replace with"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="what it should say"
        autoFocus={!!initialWhat}
      />
      <button
        type="button"
        onClick={() => setTo("I")}
        className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        This was me
      </button>
      {t === "I" && (
        <p className="text-xs text-muted">
          Object and possessive forms are handled too: &ldquo;send Zach the
          data&rdquo; becomes &ldquo;send me the data&rdquo;, &ldquo;Zach&apos;s
          territory&rdquo; becomes &ldquo;my territory&rdquo;.
        </p>
      )}
      {w && <p className="text-xs text-muted">{describeMatches(w)}</p>}

      {rememberable && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-canvas p-3 text-xs">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span>
            <span className="font-medium">
              Spell it this way in future meetings
            </span>
            <span className="mt-0.5 block text-muted">
              {known && known.right !== t
                ? `Replaces the spelling you taught it before (“${known.right}”).`
                : `New notes will say “${t}” wherever the recording says “${w}”.`}
            </span>
          </span>
        </label>
      )}

      {spellings.length > 0 && (
        <details className="rounded-lg border border-border p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            Spellings you have taught it ({spellings.length})
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {spellings.map((s) => (
              <li key={s.wrong} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted line-through">{s.wrong}</span>{" "}
                  {s.right}
                </span>
                <button
                  type="button"
                  onClick={() => onForget(s.wrong)}
                  className="shrink-0 rounded p-0.5 text-muted transition hover:text-red-600"
                  aria-label={`Forget ${s.wrong}`}
                  title="Stop correcting this one"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!w || !t}>
          Replace everywhere
        </Button>
      </div>
    </form>
  );
}
