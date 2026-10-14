"use client";

// Keeping a conversation, and finding it again.
//
// Closing the panel used to throw the conversation away. These are the
// writer's own notes about whatever they were looking at — what they worked
// out, what they decided against — and they were being discarded on the way
// out of the room.
//
// Saving is a decision, never automatic (constraint 2). Nothing in here is
// called on an answer arriving; it is called when the writer says to keep it.

import { createClient } from "@/lib/supabase/client";
import type { ChatTurn } from "./types";

const supabase = createClient();

export interface SavedChat {
  id: string;
  app: string;
  subjectKind: string;
  subjectId: string;
  title: string;
  turns: ChatTurn[];
  updatedAt: string;
}

/** Where a chat belongs: which app, and what it was about. */
export interface ChatKey {
  app: string;
  subjectKind?: string;
  subjectId?: string;
}

/**
 * A name for the thread, taken from the first thing they asked.
 *
 * No model call. Naming it costs a round trip and a wait at the exact moment
 * the writer is trying to leave, and their own first question describes the
 * conversation better than a summary of it would.
 */
export function titleFor(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.role === "user");
  const text = (first?.display || "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled chat";
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

function rowToChat(r: Record<string, unknown>): SavedChat {
  return {
    id: String(r.id),
    app: String(r.app || ""),
    subjectKind: String(r.subject_kind || ""),
    subjectId: String(r.subject_id || ""),
    title: String(r.title || "Untitled chat"),
    turns: Array.isArray(r.turns) ? (r.turns as ChatTurn[]) : [],
    updatedAt: String(r.updated_at || ""),
  };
}

/**
 * Keep this conversation.
 *
 * `id` updates the thread it came from, so reopening one, asking two more
 * things and saving again leaves one thread rather than three.
 */
export async function saveChat(
  userId: string,
  key: ChatKey,
  turns: ChatTurn[],
  id?: string,
): Promise<string | null> {
  if (!turns.length) return null;
  const row = {
    user_id: userId,
    app: key.app,
    subject_kind: key.subjectKind || "",
    subject_id: key.subjectId || "",
    title: titleFor(turns),
    turns,
  };
  if (id) {
    const { error } = await supabase.from("chats").update(row).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }
  const { data, error } = await supabase.from("chats").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data ? String(data.id) : null;
}

/**
 * This subject's chats, newest first.
 *
 * Scoped to the app as well as the subject (constraint 3): what was asked
 * about this meeting in Meeting Prep, not everything every app has ever said
 * about it. `listAppChats` is the wider net, for when they want the rest.
 */
export async function listChats(userId: string, key: ChatKey): Promise<SavedChat[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .eq("user_id", userId)
    .eq("app", key.app)
    .eq("subject_kind", key.subjectKind || "")
    .eq("subject_id", key.subjectId || "")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data || []).map(rowToChat);
}

/** Everything of theirs in this app, for the subject they are not on. */
export async function listAppChats(userId: string, app: string): Promise<SavedChat[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .eq("user_id", userId)
    .eq("app", app)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data || []).map(rowToChat);
}

export async function deleteChat(id: string): Promise<void> {
  const { error } = await supabase.from("chats").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
