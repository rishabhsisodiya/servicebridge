import { Hammer } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import type { NavItem } from "./nav-config";

/** Stands in for a screen that a later build session delivers. */
export function PlannedPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.summary} />
      <Card>
        <EmptyState
          icon={<Hammer className="size-6" />}
          title="This screen is on the way"
          description={
            item.plannedSession
              ? `It's scheduled for build session ${item.plannedSession}. Everything else in the menu marked “Soon” is scheduled the same way.`
              : "It's scheduled for a later build session."
          }
          action={
            <ButtonLink href="/" variant="secondary" size="sm">
              Back to home
            </ButtonLink>
          }
        />
      </Card>
    </>
  );
}
