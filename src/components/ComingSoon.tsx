import { PageHeader } from "@/components/PageHeader";

export function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={blurb} />
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <span className="mb-3 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
          Coming soon
        </span>
        <p className="max-w-sm text-sm text-muted">
          This module is on the Omni roadmap. Interview Prep is live today — start
          there.
        </p>
      </div>
    </>
  );
}
