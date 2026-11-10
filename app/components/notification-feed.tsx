import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { useNavigate } from "react-router";
import {
  FilterStatus,
  KnockFeedProvider,
  KnockProvider,
  NotificationFeedPopover,
  UnseenBadge,
  useKnockFeed,
  type NotificationFeedHeaderProps,
  type NotificationFeedProps,
} from "@knocklabs/react";
import { NetworkStatus, type FeedItem } from "@knocklabs/client";
import {
  Bell,
  MessageSquare,
  Receipt,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import type {
  FeedConfig,
  NotificationKind,
} from "~/lib/notifications.server";
import "@knocklabs/react/dist/index.css";

// ─── Notification Feed ───
// Knock's React feed provider, popover and feed, styled to the chosen
// prototype (Variant A): a bell beside the Cadence logo with an unread badge,
// and a dropdown beside the sidebar. Opening the dropdown never marks anything
// seen; only a row click or "Mark all read" changes the badge. A live arrival
// updates the badge only: the open list keeps the rows it opened with until it
// is reopened.

const FEED_OPTIONS = { status: "all", page_size: 20 } as const;

/** Opening the Feed must not mark anything seen, which is Knock's default. */
const keepUnseen = () => {};

const POPOVER_STYLE = {
  "--rnf-notification-feed-popover-max-w": "24rem",
  "--rnf-notification-feed-popover-min-w": "24rem",
  "--rnf-notification-feed-popover-border-radius": "var(--radius-lg)",
  "--rnf-notification-feed-popover-bg-color": "var(--popover)",
} as CSSProperties;

const KIND_META: Record<
  NotificationKind,
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

function isNotificationKind(key: string): key is NotificationKind {
  return key in KIND_META;
}

function KindIcon({ kind }: { kind: string }) {
  const { icon: Icon, className } = isNotificationKind(kind)
    ? KIND_META[kind]
    : FALLBACK_KIND;

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

function notificationUrl(item: FeedItem): string | null {
  const url = item.data?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function BellButton({
  buttonRef,
  onClick,
  badge,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label="Notifications"
      title="Notifications"
      className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Bell className="size-5" />
      {badge}
    </button>
  );
}

function MarkAllRead() {
  const { feedClient, useFeedStore } = useKnockFeed();
  const unread = useFeedStore((state) => state.metadata.unread_count);

  return (
    <button
      type="button"
      onClick={() => void feedClient.markAllAsRead()}
      disabled={unread === 0}
      className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
    >
      Mark all read
    </button>
  );
}

function FeedHeader(_: NotificationFeedHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <span className="text-sm font-semibold">Notifications</span>
      <MarkAllRead />
    </div>
  );
}

function FeedBell() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { feedClient, useFeedStore } = useKnockFeed();
  const { items, networkStatus } = useFeedStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // A live arrival may be fetched into the store while the dropdown is open.
  // These remember what it opened with, so the list only changes on reopen.
  const anchored = useRef(false);
  const sawInitialLoad = useRef(false);
  const openedIds = useRef<Set<string>>(new Set());
  const oldestAtOpen = useRef<string | null>(null);

  useEffect(() => {
    if (!open || anchored.current) return;

    if (networkStatus === NetworkStatus.loading) {
      sawInitialLoad.current = true;
      return;
    }

    if (networkStatus === NetworkStatus.ready && sawInitialLoad.current) {
      openedIds.current = new Set(items.map((item) => item.id));
      oldestAtOpen.current = items.at(-1)?.inserted_at ?? "";
      anchored.current = true;
    }
  }, [open, networkStatus, items]);

  function openFeed() {
    if (open) {
      setOpen(false);
      return;
    }

    anchored.current = false;
    sawInitialLoad.current = false;
    openedIds.current = new Set();
    oldestAtOpen.current = null;
    setOpen(true);
  }

  /**
   * While open, a row shows if it was there when the dropdown opened, or if it
   * is older than the oldest loaded row (the next page). A live arrival is
   * newer, so it waits for the next open.
   */
  function isOnScreen(item: FeedItem): boolean {
    if (!open || !anchored.current) return true;
    if (openedIds.current.has(item.id)) return true;

    const oldest = oldestAtOpen.current;
    return oldest !== null && item.inserted_at < oldest;
  }

  function openNotification(item: FeedItem) {
    void feedClient.markAsRead(item);
    const url = notificationUrl(item);

    if (url) {
      setOpen(false);
      navigate(url);
    }
  }

  const renderItem: NotificationFeedProps["renderItem"] = ({
    item,
    onItemClick,
  }) => {
    if (!isOnScreen(item)) return null;

    const isUnread = item.read_at === null;
    const hasUrl = notificationUrl(item) !== null;

    return (
      <button
        type="button"
        onClick={() => onItemClick?.(item)}
        className={cn(
          "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-accent",
          !isUnread && "opacity-55",
          !hasUrl && "cursor-default"
        )}
      >
        <KindIcon kind={item.source.key} />
        <span className="min-w-0 flex-1">
          <span className="block leading-snug">
            <NotificationText item={item} />
          </span>
          <span
            className="mt-1 block text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {formatRelativeTime(item.inserted_at)}
          </span>
        </span>
        {isUnread && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
        )}
      </button>
    );
  };

  return (
    <div
      className="notification-feed relative [&_.rnf-notification-feed__feed-items-container>*+*]:border-t"
      style={POPOVER_STYLE}
    >
      <BellButton
        buttonRef={buttonRef}
        onClick={openFeed}
        badge={<UnseenBadge badgeCountType="unread" />}
      />

      {open && (
        <NotificationFeedPopover
          isVisible={open}
          buttonRef={buttonRef}
          onOpen={keepUnseen}
          onClose={() => setOpen(false)}
          closeOnClickOutside
          placement="right-start"
          initialFilterStatus={FilterStatus.All}
          onNotificationClick={openNotification}
          renderHeader={(props) => <FeedHeader {...props} />}
          renderItem={renderItem}
          renderLoading={() => null}
          EmptyComponent={
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No Notifications yet.
            </div>
          }
        />
      )}
    </div>
  );
}

/**
 * A signed-in person still gets the bell when Knock is not configured. There is
 * no Feed to read from, so it has no badge and shows the empty state.
 */
function UnconfiguredFeed() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <BellButton onClick={() => setOpen((isOpen) => !isOpen)} />

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-full top-0 z-50 ml-3 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
            </div>
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No Notifications yet.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function NotificationFeed({ config }: { config: FeedConfig | null }) {
  if (!config) return <UnconfiguredFeed />;

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
