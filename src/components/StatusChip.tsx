const LABELS: Record<string, string> = {
  uploading: "Uploading",
  transcribing: "Transcribing",
  summarizing: "Summarizing",
  complete: "Complete",
  error: "Error",
};

// Each status maps to a CSS variable color defined in globals.css.
const COLORVAR: Record<string, string> = {
  uploading: "var(--color-status-uploading)",
  transcribing: "var(--color-status-transcribing)",
  summarizing: "var(--color-status-summarizing)",
  complete: "var(--color-status-complete)",
  error: "var(--color-status-error)",
};

export function StatusChip({
  status,
  detail,
}: {
  status: string;
  detail?: string;
}) {
  const color = COLORVAR[status] || "var(--color-muted)";
  const animated = status === "transcribing" || status === "summarizing";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${animated ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      {LABELS[status] || status}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}
