"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string;
  app: string; // general | territory | interview
  link: string;
  entity_label: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// One global to-do list for the whole app, surfaced in the top bar.
export function useTasks(userId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("completed_at", { ascending: true, nullsFirst: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);
    setTasks((data as Task[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const t = setInterval(refresh, 90000);
    return () => clearInterval(t);
  }, [refresh, userId]);

  const add = useCallback(
    async (partial: Partial<Task>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("tasks")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) setTasks((prev) => [data as Task, ...prev]);
      return (data as Task) || null;
    },
    [userId],
  );

  const update = useCallback(async (id: string, partial: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...partial } : t)));
    await supabase.from("tasks").update(partial).eq("id", id);
  }, []);

  const toggle = useCallback(
    async (id: string, done: boolean) => {
      const completed_at = done ? new Date().toISOString() : null;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed_at } : t)));
      await supabase.from("tasks").update({ completed_at }).eq("id", id);
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await supabase.from("tasks").delete().eq("id", id);
  }, []);

  const open = tasks.filter((t) => !t.completed_at);
  const now = Date.now();
  const overdue = open.filter((t) => t.due_date && new Date(t.due_date).getTime() < now).length;

  return { tasks, open, overdue, loading, refresh, add, update, toggle, remove };
}
