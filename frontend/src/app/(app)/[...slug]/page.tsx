import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findItemByHref, ALL_NAV_ITEMS, QUICK_LINKS } from "@/components/shell/nav-config";
import { PlannedPage } from "@/components/shell/planned-page";

// Serves every menu entry whose real screen hasn't been built yet. A real route
// added later (e.g. app/(app)/customers/page.tsx) takes precedence automatically.
const planned = [...ALL_NAV_ITEMS, ...QUICK_LINKS].filter((item) => item.plannedSession);

export const dynamicParams = false;

export function generateStaticParams() {
  return planned
    .filter((item) => item.href !== "/tickets/new") // has its own route beside tickets/[id]
    .map((item) => ({ slug: item.href.slice(1).split("/") }));
}

async function itemFor(props: PageProps<"/[...slug]">) {
  const { slug } = await props.params;
  const item = findItemByHref(`/${slug.join("/")}`);
  return item?.plannedSession ? item : undefined;
}

export async function generateMetadata(props: PageProps<"/[...slug]">): Promise<Metadata> {
  const item = await itemFor(props);
  return { title: item?.label ?? "Not found" };
}

export default async function PlannedRoute(props: PageProps<"/[...slug]">) {
  const item = await itemFor(props);
  if (!item) notFound();
  return <PlannedPage item={item} />;
}
