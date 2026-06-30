import { cn } from "@/lib/ui";

// Avatar with photo fallback to initials, tinted with the module accent.
export function Avatar({
  src,
  initials,
  size = 48,
  className,
}: {
  src?: string | null;
  initials: string;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={initials}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--accent)]",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials || "?"}
    </span>
  );
}
