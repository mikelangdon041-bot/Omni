"use client";

import { useState } from "react";
import { Building2, Users, User, Upload, Settings2 } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  useDashboardTiles,
  useSessionRole,
  useMaxScope,
  useImportedDatasets,
} from "@/lib/dashboard/hooks";
import { DashboardChat } from "@/components/dashboard/DashboardChat";
import { TileCard } from "@/components/dashboard/TileCard";
import { ImportModal } from "@/components/dashboard/ImportModal";
import { TeamManager } from "@/components/dashboard/TeamManager";

const SCOPE_COPY: Record<string, { icon: typeof User; text: string }> = {
  self: { icon: User, text: "You see only your own data here." },
  team: {
    icon: Users,
    text: 'New charts default to your team — set who\'s on it under "My team", or switch to "Just me" per chart.',
  },
  org: {
    icon: Building2,
    text: 'New charts default to the whole company — switch to "My team" or "Just me" per chart if you want.',
  },
};

export default function DashboardPage() {
  const { userId, loading: roleLoading } = useSessionRole();
  const { maxScope, loading: scopeLoading } = useMaxScope();
  const { datasets: importedDatasets, refresh: refreshImports } = useImportedDatasets();
  const { tiles, loading: tilesLoading, refresh } = useDashboardTiles();
  const [importOpen, setImportOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const scopeInfo = SCOPE_COPY[maxScope] || SCOPE_COPY.self;

  return (
    <>
      <ModuleHero
        eyebrow="Omni"
        title="Dashboard"
        subtitle="Visualize data from any app — ask in plain language, or import a spreadsheet."
        stats={
          scopeLoading
            ? undefined
            : [{ label: "View", value: maxScope === "org" ? "Company" : maxScope === "team" ? "Team" : "You" }]
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTeamOpen(true)}>
              <Settings2 size={14} /> My team
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import spreadsheet
            </Button>
          </div>
        }
      />

      {!roleLoading && !scopeLoading && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted">
          <scopeInfo.icon size={13} />
          {scopeInfo.text}
        </div>
      )}

      <div className="flex flex-col gap-5">
        <DashboardChat maxScope={maxScope} extraDatasets={importedDatasets} onSaved={refresh} />

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
                extraDatasets={importedDatasets}
                canDelete={tile.created_by === userId}
                onDeleted={refresh}
              />
            ))}
          </div>
        )}
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refreshImports}
      />
      <TeamManager open={teamOpen} onClose={() => setTeamOpen(false)} />
    </>
  );
}
