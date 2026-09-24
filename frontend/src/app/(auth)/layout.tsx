import { BrandMark } from "@/components/shell/sidebar";

/** Sign-in and link pages: no app shell, one focused form. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between gap-8 overflow-hidden border-r border-white/10 bg-rail p-10 text-rail-text lg:flex">
        <BrandMark />
        <div className="flex max-w-md flex-col gap-3">
          <p className="text-3xl leading-tight font-semibold text-balance text-white">
            Service tickets, field visits and your ERP in one place.
          </p>
          <p className="text-rail-muted">
            Log breakdowns, dispatch engineers, track SLAs and read sales and stock figures straight
            from ERPNext.
          </p>
        </div>
        <p className="text-xs text-rail-muted">
          Need access? Ask your ServiceBridge administrator.
        </p>
      </aside>
      <main id="main" className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden [&_span]:!text-text">
            <BrandMark />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
