import { Construction } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

// Temporary stand-in for routes that later phases build (docs/06-BUILD-PLAN.md).
export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={<Construction />}
        title="Not built yet"
        description={`${title} arrives in Phase ${phase} of the build plan.`}
      />
    </>
  );
}
