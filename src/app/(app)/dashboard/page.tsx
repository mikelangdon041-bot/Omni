"use client";

import { Building2, User } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDashboardTiles, useSessionRole } from "@/lib/dashboard/hooks";
import { DashboardChat } from "@/components/dashboard/DashboardChat";
import { TileCard } from "@/components/dashboard/TileCard";

export default function DashboardPage() {
  const { userId, isManager, loading: roleLoading } = useSessionRole();
  const { tiles, loading: tilesLoading, refresh } = useDashboardTiles();

  return (
    <>
      <ModuleHero
        eyebrow="Omni"
        title="Dashboard"
        subtitle={
          isManager
            ? "Visualize data from any app across your team. Build charts by asking in plain language."
            : "Visualize your own data from any app. Build charts by asking in plain language."
        }
        stats={
          roleLoading
            ? undefined
            : [
                {
                  label: "View",
                  value: isManager ? "Team" : "You",
                },
              ]
        }
      />

      {!roleLoading && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted">
          {isManager ? <Building2 size={13} /> : <User size={13} />}
          {isManager
            ? "As a manager, new charts default to your whole team — switch to \"Just me\" per chart if you want."
            : "You see only your own data here."}
        </div>
      )}

      <div className="flex flex-col gap-5">
        <DashboardChat isManager={isManager} onSaved={refresh} />

        {tilesLoading ? (
          <p className="py-8 text-center text-sm text-muted">Loading your dashboard…</p>
        ) : tiles.length === 0 ? (
          <EmptyState
            title="No saved charts yet"
            hint="Ask above to build your first one — pick any app's data and confirm the preview to save it here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((tile) => (
              <TileCard
                key={tile.id}
                tile={tile}
                canDelete={tile.created_by === userId}
                onDeleted={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
