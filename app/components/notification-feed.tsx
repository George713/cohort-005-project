import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  KnockFeedProvider,
  KnockProvider,
  useKnockFeed,
} from "@knocklabs/react";
import { NetworkStatus, type FeedItem } from "@knocklabs/client";
import {
  Bell,
  MessageSquare,
  Receipt,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { FeedConfig } from "~/lib/notifications.server";

// ─── Notification Feed ───
// Knock's React feed, styled to the chosen prototype (Variant A): a bell beside
// the Cadence logo with an unread badge, and a dropdown beside the sidebar.
// Opening the dropdown never marks anything seen; only a row click or "Mark all
// read" changes the badge.

const FEED_OPTIONS = { status: "all", page_size: 20 } as const;

const KIND_META: Record<
  string,
  { icon: typeof Bell; className: string }
> = {
  "refund-request-opened": {
    icon: Receipt,
    className: "bg-amber-500/10 text-amber-600",
  },
  "refund-request-approved": {
    icon: Receipt,
    className: "bg-emerald-500/10 text-emerald-600",
  },
  "refund-request-declined": {
    icon: Receipt,
    className: "bg-rose-500/10 text-rose-600",
  },
  "discussion-reply-from-staff": {
    icon: MessageSquare,
    className: "bg-sky-500/10 text-sky-600",
  },
  "discussion-question-new": {
    icon: MessageSquare,
    className: "bg-sky-500/10 text-sky-600",
  },
  "enrollment-new": {
    icon: UserPlus,
    className: "bg-violet-500/10 text-violet-600",
  },
  "seat-claimed": {
    icon: UsersRound,
    className: "bg-teal-500/10 text-teal-600",
  },
};

const FALLBACK_KIND = {
  icon: Bell,
  className: "bg-muted text-muted-foreground",
};

function KindIcon({ workflow }: { workflow: string }) {
  const { icon: Icon, className } =
    KIND_META[workflow] ?? FALLBACK_KIND;

  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        className
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** The Knock-rendered body, with **bold** segments kept bold. */
function NotificationText({ item }: { item: FeedItem }) {
  const block = item.blocks.find(
    (candidate) => candidate.type === "markdown" || candidate.type === "text"
  );
  const text = block?.content ?? "You have a new Notification.";

  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

function relativeTime(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function notificationUrl(item: FeedItem): string | null {
  const url = item.data?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function FeedBell() {
  const { feedClient, useFeedStore } = useKnockFeed();
  const { items, metadata, pageInfo, networkStatus } = useFeedStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const fetchedFor = useRef<typeof feedClient | null>(null);

  useEffect(() => {
    if (fetchedFor.current === feedClient) return;
    fetchedFor.current = feedClient;

    let cancelled = false;
    void feedClient.fetch().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [feedClient]);

  const unread = metadata.unread_count;

  function openNotification(item: FeedItem) {
    void feedClient.markAsRead(item);
    const url = notificationUrl(item);

    if (url) {
      setOpen(false);
      navigate(url);
    }
  }

  function loadNextPage(element: HTMLUListElement) {
    if (!pageInfo.after || networkStatus !== NetworkStatus.ready) return;
    if (
      element.scrollTop + element.clientHeight <
      element.scrollHeight - 24
    ) {
      return;
    }
    void feedClient.fetchNextPage();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-full top-0 z-50 ml-3 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              <button
                type="button"
                onClick={() => void feedClient.markAllAsRead()}
                disabled={unread === 0}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
              >
                Mark all read
              </button>
            </div>

            <ul
              className="max-h-[28rem] divide-y overflow-y-auto"
              onScroll={(event) => loadNextPage(event.currentTarget)}
            >
              {!loading && items.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No Notifications yet.
                </li>
              )}

              {items.map((item) => {
                const isUnread = item.read_at === null;
                const hasUrl = notificationUrl(item) !== null;

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(item)}
                      className={cn(
                        "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-accent",
                        !isUnread && "opacity-55",
                        !hasUrl && "cursor-default"
                      )}
                    >
                      <KindIcon workflow={item.source.key} />
                      <span className="min-w-0 flex-1">
                        <span className="block leading-snug">
                          <NotificationText item={item} />
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {relativeTime(item.inserted_at)}
                        </span>
                      </span>
                      {isUnread && (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function NotificationFeed({
  config,
}: {
  config: FeedConfig;
}) {
  return (
    <KnockProvider
      apiKey={config.publicApiKey}
      user={{ id: config.userId }}
      userToken={config.userToken}
      enabled
    >
      <KnockFeedProvider
        feedId={config.feedChannelId}
        defaultFeedOptions={FEED_OPTIONS}
      >
        <FeedBell />
      </KnockFeedProvider>
    </KnockProvider>
  );
}
