// Shared shimmer placeholder for route-level `loading.tsx` files. Navigation
// paints this immediately instead of sitting on the previous page while the
// server render finishes.
export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      <div className="h-32 rounded-2xl bg-canvas sm:h-40" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-canvas" />
        ))}
      </div>
    </div>
  );
}
