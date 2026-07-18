"use client";

// Per-user Slide Studio defaults: theme (colors/fonts/transition) and
// generation options. Stored in sl_prefs; localStorage keeps a copy so the
// feature still works if the migration hasn't been applied yet.

import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SLIDE_THEME, type SlideTheme } from "./types";

const supabase = createClient();
const LS_KEY = "omni-slide-prefs";

export interface SlidePrefs {
  theme: SlideTheme;
  aiImages: boolean; // generate images for image layouts when building decks
}

export const DEFAULT_SLIDE_PREFS: SlidePrefs = {
  theme: DEFAULT_SLIDE_THEME,
  aiImages: true,
};

function fromLocal(): SlidePrefs | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      theme: { ...DEFAULT_SLIDE_THEME, ...(p.theme || {}) },
      aiImages: p.aiImages !== false,
    };
  } catch {
    return null;
  }
}

export async function loadSlidePrefs(userId: string | null): Promise<SlidePrefs> {
  if (userId) {
    try {
      const { data, error } = await supabase
        .from("sl_prefs")
        .select("theme, options")
        .eq("user_id", userId)
        .maybeSingle();
      if (!error && data) {
        const opts = (data.options || {}) as { aiImages?: boolean };
        return {
          theme: { ...DEFAULT_SLIDE_THEME, ...((data.theme || {}) as Partial<SlideTheme>) },
          aiImages: opts.aiImages !== false,
        };
      }
    } catch {
      // table missing → fall through to localStorage
    }
  }
  return fromLocal() || DEFAULT_SLIDE_PREFS;
}

export async function saveSlidePrefs(userId: string | null, prefs: SlidePrefs): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    // storage full/blocked — DB write below still applies
  }
  if (!userId) return;
  try {
    await supabase
      .from("sl_prefs")
      .upsert({ user_id: userId, theme: prefs.theme, options: { aiImages: prefs.aiImages } });
  } catch {
    // table missing — localStorage copy already saved
  }
}
