export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-fg shadow-sm">
        <span className="text-lg font-bold leading-none">O</span>
        <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="tracking-tight">
        Omni<span className="text-muted font-normal"> · MSL</span>
      </span>
    </span>
  );
}
