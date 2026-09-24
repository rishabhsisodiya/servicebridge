import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface shadow-sm">
        <h1 className="sr-only">Page not found</h1>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="We couldn't find that page"
          description="The link may be out of date, or the record was removed. Check the address, or start again from home."
          action={
            <ButtonLink href="/" variant="primary" size="sm">
              Go to home
            </ButtonLink>
          }
        />
      </div>
    </main>
  );
}
