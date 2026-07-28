// Em dashes are the loudest "a machine wrote this" tell, and prompt guidance
// alone does not stop a model from producing them — it will comply for a
// paragraph and then relapse. So every generated string is run through here on
// the way out, and the rule stops being a suggestion.
//
// The substitution is a comma, which is what an em dash is standing in for in
// almost every case a model uses one (an aside, or a beat before a clause).
// The cleanup pass afterwards repairs the punctuation pileups that creates.

const HAS_DASH = /—|–|--/;

export function stripEmDashes(input: string): string {
  if (!input || !HAS_DASH.test(input)) return input;

  let out = input
    // Number ranges are the one honest use of a dash: 5–7, 2024–2025.
    .replace(/(\d)\s*[—–]\s*(?=\d)/g, "$1-")
    // Everything else becomes a comma, spaced or unspaced.
    .replace(/\s*(?:—|–|--)\s*/g, ", ");

  out = out
    // ",," / ";," / ": ," → keep the stronger mark only.
    .replace(/([,;:])\s*,\s*/g, "$1 ")
    // A comma immediately before other punctuation is noise.
    .replace(/\s*,\s*([.!?;:])/g, "$1")
    .replace(/\s+,/g, ",")
    // A dash that opened a line or a list item was decoration, not punctuation.
    .replace(/(^|<(?:p|li|div)\b[^>]*>|<br\s*\/?>)\s*,\s*/gi, "$1")
    // …and one left dangling at the end of a block is the same story.
    .replace(/,\s*(<\/(?:p|li|div)>|<br\s*\/?>)/gi, "$1")
    .replace(/,\s*$/, "");

  return out;
}
