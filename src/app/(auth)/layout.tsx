import { Logo } from "@/components/Logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden p-6">
      {/* subtle accent backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 40rem at 110% -10%, var(--color-primary-soft), transparent), radial-gradient(40rem 30rem at -10% 120%, var(--color-accent-soft), transparent)",
        }}
      />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="text-xl" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Omni — toolkit for Medical Science Liaisons
        </p>
      </div>
    </div>
  );
}
