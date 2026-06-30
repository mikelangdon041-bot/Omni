import { cn } from "@/lib/territory/utils";

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className || "bg-slate-100 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}
