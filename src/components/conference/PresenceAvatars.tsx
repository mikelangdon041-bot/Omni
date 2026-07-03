"use client";

// Live "who else is viewing this right now" avatars (spec §15).

import { Avatar } from "@/components/ui/Avatar";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { usePresence } from "@/lib/conference/hooks";
import { initials } from "@/lib/conference/utils";

export function PresenceAvatars({ channelKey }: { channelKey: string }) {
  const { me, myAttendee } = useConferenceCtx();
  const viewers = usePresence(
    channelKey,
    me ? { id: me.id, name: myAttendee?.name || me.displayName } : null,
  );

  if (viewers.length === 0) return null;
  return (
    <div
      className="flex items-center"
      title={`Also viewing: ${viewers.map((v) => v.name).join(", ")}`}
    >
      <div className="flex -space-x-2">
        {viewers.slice(0, 4).map((v) => (
          <Avatar
            key={v.id}
            initials={initials(v.name)}
            size={26}
            className="ring-2 ring-surface"
          />
        ))}
      </div>
      <span className="ml-1.5 text-[11px] font-medium text-emerald-600">
        viewing now
      </span>
    </div>
  );
}
