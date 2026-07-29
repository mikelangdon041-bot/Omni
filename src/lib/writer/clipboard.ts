// Turning stored draft HTML into something that survives a paste into Outlook,
// Gmail, or Teams.
//
// The stored HTML is deliberately minimal (<p>, <br>, <ul>) with no styling. Mail
// clients then apply their own paragraph rules, and Outlook in particular zeroes
// out <p> margins — so a four-paragraph email pasted in arrives as one wall of
// text with the line breaks gone. Giving every block an explicit inline margin
// is the only thing that holds across clients, since none of them honour a
// stylesheet from the clipboard.

const BLOCK_MARGIN = "margin:0 0 12px 0";

/** Draft HTML plus an optional signature, styled to paste correctly into mail. */
export function toEmailHtml(bodyHtml: string, signatureHtml = ""): string {
  const body = withInlineSpacing(bodyHtml);
  const signature = signatureHtml
    ? `<div style="${BLOCK_MARGIN}">${withInlineSpacing(signatureHtml)}</div>`
    : "";
  // A wrapper font stack stops the paste arriving as Times New Roman.
  return `<div style="font-family:Calibri,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45;">${body}${signature}</div>`;
}

function withInlineSpacing(html: string): string {
  return (
    html
      // Paragraphs and headings carry their own bottom margin.
      .replace(/<(p|h[1-6])(\s[^>]*)?>/gi, (_m, tag, attrs = "") =>
        `<${tag}${mergeStyle(attrs, BLOCK_MARGIN)}>`,
      )
      // Lists keep their bullets but lose the browser's big default padding.
      .replace(/<(ul|ol)(\s[^>]*)?>/gi, (_m, tag, attrs = "") =>
        `<${tag}${mergeStyle(attrs, `${BLOCK_MARGIN};padding-left:24px`)}>`,
      )
      .replace(/<li(\s[^>]*)?>/gi, (_m, attrs = "") =>
        `<li${mergeStyle(attrs, "margin:0 0 4px 0")}>`,
      )
      // An empty paragraph is how the editor spells "blank line"; give it a
      // height so clients don't collapse it away.
      .replace(/<p([^>]*)>\s*(?:&nbsp;)?\s*<\/p>/gi, '<p$1>&nbsp;</p>')
  );
}

/** Add `style` to a tag's attributes, keeping any style that's already there. */
function mergeStyle(attrs: string, style: string): string {
  if (/\sstyle\s*=/i.test(attrs))
    return attrs.replace(/(\sstyle\s*=\s*")([^"]*)"/i, (_m, lead, existing) =>
      `${lead}${existing.replace(/;\s*$/, "")};${style}"`,
    );
  return `${attrs} style="${style}"`;
}
