"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { cn } from "@/lib/ui";

interface ConfirmOpts {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
type ToastKind = "error" | "success" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const Ctx = createContext<{
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  toast: (kind: ToastKind, message: string) => void;
} | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { open: boolean }) | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState({ ...o, open: true });
      }),
    [],
  );

  const settle = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  };

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={{ confirm, toast }}>
      {children}

      <Modal
        open={!!state?.open}
        onClose={() => settle(false)}
        title={state?.title || "Are you sure?"}
        size="sm"
      >
        {state?.message && <p className="text-sm text-muted">{state.message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => settle(false)}>
            {state?.cancelLabel || "Cancel"}
          </Button>
          <Button
            variant={state?.danger ? "danger" : "primary"}
            onClick={() => settle(true)}
          >
            {state?.confirmLabel || "Confirm"}
          </Button>
        </div>
      </Modal>

      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              t.kind === "error"
                ? "bg-status-error"
                : t.kind === "success"
                  ? "bg-status-complete"
                  : "bg-ink",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  return useContext(Ctx)!.confirm;
}
export function useToast() {
  return useContext(Ctx)!.toast;
}
