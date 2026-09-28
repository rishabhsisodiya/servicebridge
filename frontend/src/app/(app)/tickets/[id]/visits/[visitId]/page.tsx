import { VisitScreen } from "@/features/visits/visit-screen";

export default async function VisitPage({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>;
}) {
  const { id, visitId } = await params;
  return (
    <VisitScreen visitId={decodeURIComponent(visitId)} ticketRef={decodeURIComponent(id)} />
  );
}
