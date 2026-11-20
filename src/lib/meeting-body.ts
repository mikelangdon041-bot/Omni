// The meeting invite's body, for Outlook's new-meeting window
// (components/outlook/MeetingCard.tsx). Kept apart so it can be checked alone.

/**
 * The agenda as Outlook's meeting body. Outlook reads this field as HTML, so
 * plain text arrived as one run-on line: every line break dropped. Short
 * paragraphs, "- " lines as a bulleted list, the first line in bold, and the
 * closing hold line set apart in grey.
 */
export function agendaHtml(text: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const p = "margin:0 0 8px 0";
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      out.push(
        `<ul style="margin:0 0 8px 0;padding-left:22px">${list
          .map((li) => `<li style="margin:0 0 2px 0">${li}</li>`)
          .join("")}</ul>`,
      );
    list = [];
  };
  const lines = (text || "").split(/\r?\n/).map((l) => l.trim());
  lines.forEach((line, i) => {
    if (!line) return flush();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) return void list.push(esc(bullet[1]));
    flush();
    const last = lines.slice(i + 1).every((l) => !l);
    if (i === 0) out.push(`<p style="${p}"><b>${esc(line)}</b></p>`);
    else if (last && /hold|final invite|placeholder/i.test(line))
      out.push(`<p style="margin:12px 0 0 0;color:#666666"><i>${esc(line)}</i></p>`);
    else out.push(`<p style="${p}">${esc(line)}</p>`);
  });
  flush();
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${out.join("")}</div>`;
}
