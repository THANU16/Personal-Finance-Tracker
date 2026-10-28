import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { MobileKitDemo } from "@/components/shared/mobile/mobile-kit-demo";
import { getEnv } from "@/server/env";

export const metadata: Metadata = { title: "Mobile kit" };

/** Development only: every mobile primitive on one page (docs/08 M2). */
export default function MobileKitPage() {
  if (getEnv().NODE_ENV === "production") notFound();
  return (
    <>
      <PageHeader
        title="Mobile kit"
        description="Responsive primitives for phones (docs/07). Development only."
      />
      <MobileKitDemo />
    </>
  );
}
