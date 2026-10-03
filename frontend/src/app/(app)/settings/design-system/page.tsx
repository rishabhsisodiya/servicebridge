import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { SystemStatus } from "@/components/system/system-status";
import { DesignSystemShowcase } from "@/features/design-system/showcase";

export const metadata: Metadata = { title: "Design system" };

export default function DesignSystemPage() {
  return (
    <>
      <PageHeader
        title="Design system"
        description="Colours, components and UI states used across ERPTick. For developers building new screens."
      />
      <Card aria-labelledby="ds-api">
        <CardHeader titleId="ds-api" title="Backend status" meta="Live" />
        <CardBody>
          <SystemStatus />
        </CardBody>
      </Card>
      <DesignSystemShowcase />
    </>
  );
}
