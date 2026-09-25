"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Button, IconButton } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { formatWhen } from "@/features/tickets/format";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  ticket: { id: string; number: string } | null;
}

const COUNT_KEY = "/notifications/unread-count";
const LIST_KEY = "/notifications";
const fetcher = <T,>(key: string) => apiFetch<T>(key);

/**
 * The unread count refreshes every minute and when the tab regains focus; the
 * list loads only when the panel opens. (Server push can replace polling later.)
 */
export function NotificationBell() {
  const router = useRouter();
  const count = useSWR<{ unread: number }>(COUNT_KEY, fetcher, { refreshInterval: 60_000 });
  const unread = count.data?.unread ?? 0;

  const markRead = async (ids?: string[]) => {
    const result = await apiFetch<{ unread: number }>("/notifications/read", {
      method: "POST",
      json: ids ? { ids } : {},
    });
    void count.mutate({ unread: result.unread }, { revalidate: false });
  };

  return (
    <Popover
      className="w-[min(380px,calc(100vw-32px))]"
      trigger={(props) => (
        <IconButton
          label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          {...props}
          onClick={() => {
            props.onClick();
            void count.mutate();
          }}
        >
          <Bell className="size-[18px]" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] leading-4 font-bold text-surface"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </IconButton>
      )}
    >
      {(close) => (
        <NotificationList
          unread={unread}
          onOpenItem={async (item) => {
            close();
            if (!item.readAt) await markRead([item.id]);
            if (item.ticket) router.push(`/tickets/${item.ticket.number}`);
          }}
          onMarkAll={() => markRead()}
        />
      )}
    </Popover>
  );
}

function NotificationList({
  unread,
  onOpenItem,
  onMarkAll,
}: {
  unread: number;
  onOpenItem: (item: NotificationItem) => Promise<void>;
  onMarkAll: () => Promise<void>;
}) {
  const { data, error, mutate } = useSWR<{ items: NotificationItem[] }>(LIST_KEY, fetcher);
  const now = new Date();

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="flex-1 font-semibold">Notifications</span>
        {unread > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<CheckCheck className="size-4" aria-hidden />}
            onClick={async () => {
              await onMarkAll();
              await mutate();
            }}
          >
            Mark all read
          </Button>
        )}
      </div>
      {!data && !error && <p className="px-4 py-6 text-center text-muted">Loading…</p>}
      {error && <p className="px-4 py-6 text-center text-bad">Couldn&apos;t load notifications.</p>}
      {data?.items.length === 0 && (
        <p className="px-4 py-6 text-center text-muted">
          You&apos;re all caught up. Assignments and SLA alerts will show here.
        </p>
      )}
      {data && data.items.length > 0 && (
        <ul
          className="m-0 max-h-[60dvh] list-none overflow-y-auto p-0"
          aria-label="Recent notifications"
        >
          {data.items.map((item) => (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => void onOpenItem(item)}
                className="flex w-full cursor-pointer items-start gap-2.5 px-4 py-2.5 text-left hover:bg-surface-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    item.readAt ? "bg-transparent" : "bg-accent",
                  )}
                />
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className={cn("block", !item.readAt && "font-semibold")}>
                    {item.title}
                    {!item.readAt && <span className="sr-only"> (unread)</span>}
                  </span>
                  {item.body && <span className="block truncate text-muted">{item.body}</span>}
                  <time dateTime={item.createdAt} className="block text-xs text-muted">
                    {formatWhen(item.createdAt, now)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
