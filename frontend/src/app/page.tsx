import { SystemStatus } from "./system-status";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">ServiceBridge</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Foundations are in place. The app shell and design system arrive in the next build
          session.
        </p>
      </div>
      <SystemStatus />
    </main>
  );
}
