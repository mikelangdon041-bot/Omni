// Renaming a person across a set of notes.
//
// The naive version — replace every occurrence of the string — breaks in two
// places, and both show up constantly in real notes:
//
//   * Substring collisions. Replacing "Zach" would also hit "Zachary", and
//     replacing "Sam" would hit "Samsung". Matches are bounded to whole words.
//   * Changing someone to "I". "Zach raised the dosing question" becomes "I
//     raised…" correctly, but "Send Zach the data" becomes "Send I the data",
//     and "Zach's territory" becomes "I's territory". First person needs the
//     object and possessive forms too.

export function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word boundaries that also work for names carrying punctuation
// ("Dr. Chen"), where \b lands in the wrong place.
function boundedRx(phrase: string, flags = "g"): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRx(phrase)}(?![A-Za-z0-9])`, flags);
}

const FIRST_PERSON = new Set(["I", "i", "me"]);

// Rename `from` to `to` inside a plain string.
export function renameInText(text: string, from: string, to: string): string {
  if (!from.trim() || !text) return text;

  if (FIRST_PERSON.has(to.trim())) {
    return (
      text
        // "Zach's territory" -> "my territory"
        .replace(new RegExp(`(?<![A-Za-z0-9])${escapeRx(from)}'s(?![A-Za-z0-9])`, "g"), "my")
        // "send Zach the data" / "with Zach" -> object form
        .replace(
          new RegExp(
            `(?<![A-Za-z0-9])(to|with|for|from|about|between|alongside|told|asked|ask|give|gave|send|sent|email|emailed|owes|owe)\\s+${escapeRx(from)}(?![A-Za-z0-9])`,
            "gi",
          ),
          (_m, verb) => `${verb} me`,
        )
        // Everything left is the subject.
        .replace(boundedRx(from), "I")
        // "my territory was reviewed" at the start of a sentence needs its
        // capital back — the substitutions above are lower case by design.
        .replace(/(^|[.!?]\s+)(my|me)\b/g, (_m, lead, word) => `${lead}${word[0].toUpperCase()}${word.slice(1)}`)
    );
  }

  return text.replace(boundedRx(from), to);
}

// Same, but only touching text between tags so a name that collides with
// markup can't corrupt the document.
export function renameInHtml(html: string, from: string, to: string): string {
  if (!from.trim() || !html) return html;
  return html
    .split(/(<[^>]*>)/g)
    .map((part) => (part.startsWith("<") ? part : renameInText(part, from, to)))
    .join("");
}

// How many whole-word matches are in a plain string — for showing what a
// rename will touch before it is applied.
export function countMatches(text: string, phrase: string): number {
  if (!phrase.trim() || !text) return 0;
  return (text.match(boundedRx(phrase)) || []).length;
}

export function countMatchesInHtml(html: string, phrase: string): number {
  if (!phrase.trim() || !html) return 0;
  return html
    .split(/(<[^>]*>)/g)
    .filter((part) => !part.startsWith("<"))
    .reduce((n, part) => n + countMatches(part, phrase), 0);
}

// Renames the user has already made, replayed over freshly generated notes so
// a re-analysis doesn't undo their naming. Applied in insertion order.
export type NameMap = Record<string, string>;

export function applyNameMap(text: string, map: NameMap | undefined, html = false): string {
  if (!map) return text;
  let out = text;
  for (const [from, to] of Object.entries(map)) {
    out = html ? renameInHtml(out, from, to) : renameInText(out, from, to);
  }
  return out;
}
