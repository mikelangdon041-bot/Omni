import { cn } from "@/lib/ui";

export function StatTile({
  label,
  value,
  hint,
  hintColor,
}: {
  label: string;
  value: string | number;
  hint?: string;
  hintColor?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {hint && (
        <p className={cn("mt-0.5 text-xs font-medium", hintColor)}>{hint}</p>
      )}
    </div>
  );
}
