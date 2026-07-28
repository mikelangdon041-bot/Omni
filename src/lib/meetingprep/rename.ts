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
    const f = escapeRx(from);
    return (
      text
        // Possessive first: "the manager's team" is "my team", not "I's team".
        // Both apostrophes matter — generated notes use the typographic one,
        // and matching only the straight one is why this used to produce "I".
        .replace(new RegExp(`(?<![A-Za-z0-9])${f}['’]s(?![A-Za-z0-9])`, "gi"), "my")
        // Object position after a preposition or a transitive verb.
        .replace(
          new RegExp(
            `(?<![A-Za-z0-9])(to|with|for|from|about|between|alongside|against|on|by|at|of|towards?|regarding|told|tell|asked|ask|give|gave|show|showed|send|sent|email|emailed|owes|owe|join|joined|met|meet|copy|copied|update|updated)\\s+${f}(?![A-Za-z0-9])`,
            "gi",
          ),
          (_m, lead) => `${lead} me`,
        )
        // Whatever is left is the subject.
        .replace(boundedRx(from, "gi"), "I")
        // The substitutions above are lower case by design; sentence starts
        // need their capital back.
        .replace(
          /(^|[.!?]\s+|<li>|<\/?[a-z]+>\s*)(my|me)\b/g,
          (_m, lead, word) => `${lead}${word[0].toUpperCase()}${word.slice(1)}`,
        )
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
