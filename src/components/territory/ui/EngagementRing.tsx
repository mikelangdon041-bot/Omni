import { getAdvocateLevel } from "@/lib/territory/utils";

// A small SVG progress ring for an engagement score. The ring fills relative to
// a soft 100-point reference; the score itself is uncapped and shown in the hub.
export function EngagementRing({
  score,
  size = 48,
}: {
  score: number;
  size?: number;
}) {
  const stroke = size <= 40 ? 4 : 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / 100));
  const level = getAdvocateLevel(score);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-semibold leading-none text-ink">
          {score}
        </span>
      </div>
      <span className="sr-only">{level.label}</span>
    </div>
  );
}
