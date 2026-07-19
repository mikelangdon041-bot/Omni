export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <span className="omni-gradient grid h-8 w-8 place-items-center rounded-lg text-white shadow-sm">
        <span className="text-lg font-bold leading-none">O</span>
      </span>
      <span className="tracking-tight">Omni</span>
    </span>
  );
}
