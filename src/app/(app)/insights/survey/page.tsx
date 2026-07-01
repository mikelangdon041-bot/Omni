import Link from "next/link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { SurveyBuilder } from "@/components/insights/SurveyBuilder";

export default function SurveyBuilderPage() {
  return (
    <>
      <Link
        href="/insights"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
      >
        <ArrowLeft size={16} /> Back to Insights
      </Link>
      <ModuleHero
        eyebrow="Insights · Survey"
        icon={ClipboardList}
        title="Design the survey"
        subtitle="Build the canonical, branching KOL survey. Choice answers can reveal follow-up questions — like a natural conversation — so every MSL captures comparable data."
      />
      <SurveyBuilder />
    </>
  );
}
