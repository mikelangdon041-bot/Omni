"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// Avatar with click-to-upload. Stores in the public kol-photos bucket and
// writes the public URL back via onChange.
export function KolPhoto({
  kolId,
  photoUrl,
  initials,
  onChange,
  size = 64,
}: {
  kolId: string;
  photoUrl: string;
  initials: string;
  onChange: (url: string) => void;
  size?: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image.");
      return;
    }
    setBusy(true);
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${kolId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("kol-photos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setBusy(false);
      setError("Upload failed. Try again.");
      return;
    }
    const { data } = supabase.storage.from("kol-photos").getPublicUrl(path);
    onChange(data.publicUrl);
    setBusy(false);
  }

  return (
    <div className="shrink-0">
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="group relative block overflow-hidden rounded-full"
        style={{ width: size, height: size }}
        title="Change photo"
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-[var(--accent-soft)] text-lg font-semibold text-[var(--accent)]">
            {initials || "?"}
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        </span>
      </button>
      {error && <p className="mt-1 max-w-[8rem] text-[11px] text-status-error">{error}</p>}
    </div>
  );
}
