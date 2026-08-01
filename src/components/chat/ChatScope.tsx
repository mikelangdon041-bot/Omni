"use client";

// How a page tells the floating chat what it is looking at.
//
// The bubble is mounted once, in the app shell, so it sits in the same place in
// every app at every scroll position. That means it cannot know what is on
// screen by itself: each page registers its own scope on mount and clears it on
// unmount. A page that registers nothing still gets a chat, one that knows which
// app it is in and can do that app's app-level work.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { moduleForPath } from "@/lib/modules";
import type { ChatAppId, ChatScopeValue } from "@/lib/chat/types";

interface Store {
  scope: ChatScopeValue | null;
  set: (v: ChatScopeValue | null) => void;
  /** What a section of the app is true for, under whatever page is open. */
  base: ChatScopeValue | null;
  setBase: (v: ChatScopeValue | null) => void;
}

const ChatScopeContext = createContext<Store | null>(null);

export function ChatScopeProvider({ children }: { children: ReactNode }) {
  const [scope, set] = useState<ChatScopeValue | null>(null);
  const [base, setBase] = useState<ChatScopeValue | null>(null);
  const value = useMemo(() => ({ scope, set, base, setBase }), [scope, base]);
  return <ChatScopeContext.Provider value={value}>{children}</ChatScopeContext.Provider>;
}

/**
 * Register what the chat can see on this page. Everything except `app` is
 * optional: a list page can pass a summary of the list and no subject, and a
 * detail page passes the record it is showing.
 *
 * The value is serialized for comparison rather than depended on by reference,
 * so a page can build it inline on every render without looping.
 */
export function useChatScope(value: ChatScopeValue | null) {
  useRegister(value, false);
}

/**
 * The same, for a layout or provider that wraps a whole section: which app this
 * is and the ids everything under it shares. It lives in its own slot because
 * child effects run before parent ones, so a layout writing to the same slot as
 * its page would land second and wipe the more specific scope out.
 */
export function useChatBase(value: ChatScopeValue | null) {
  useRegister(value, true);
}

function useRegister(value: ChatScopeValue | null, isBase: boolean) {
  const store = useContext(ChatScopeContext);
  const set = isBase ? store?.setBase : store?.set;
  // Functions can't be compared, so they ride along outside the fingerprint and
  // are read through a ref the registered scope closes over. Written in an
  // effect rather than during render, so a render that React throws away can't
  // leave the chat holding a callback from a page state that never existed.
  const live = useRef(value);
  useEffect(() => {
    live.current = value;
  });
  const fingerprint = value
    ? JSON.stringify([
        value.app,
        value.context,
        value.subject,
        value.ids,
        !!value.onEdit,
        value.editLabel,
        value.editBusy,
      ])
    : "";

  useEffect(() => {
    if (!set) return;
    if (!fingerprint) {
      set(null);
      return;
    }
    const v = live.current;
    if (!v) return;
    set({
      ...v,
      // Always call through to whatever the page's latest render produced, so a
      // stale closure can't refine an out-of-date draft.
      onEdit: v.onEdit ? (i: string) => live.current?.onEdit?.(i) : undefined,
    });
    return () => set(null);
  }, [fingerprint, set]);
}

/**
 * The page's own scope over its section's, over the route. A page that
 * registers nothing still gets a chat that knows which app it is in; a page
 * inside a section inherits that section's ids without repeating them.
 */
export function useResolvedScope(): ChatScopeValue {
  const store = useContext(ChatScopeContext);
  const pathname = usePathname() || "/";
  const fallbackApp = (moduleForPath(pathname).slug || "home") as ChatAppId;
  const { scope, base } = store || { scope: null, base: null };
  return useMemo(() => {
    if (!scope && !base) return { app: fallbackApp, context: "" };
    if (!scope) return base as ChatScopeValue;
    if (!base) return scope;
    return {
      ...base,
      ...scope,
      ids: { ...(base.ids || {}), ...(scope.ids || {}) },
      // Both are true at once: what the section is, then what is open in it.
      context: [base.context, scope.context].filter(Boolean).join("\n\n---\n\n"),
    };
  }, [scope, base, fallbackApp]);
}
