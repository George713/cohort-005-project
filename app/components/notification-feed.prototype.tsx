// PROTOTYPE (throwaway, never merge): three variants of the Notification Feed,
// switchable via ?variant=A|B|C on every page inside the app layout.
// Question: where does the entry point live, what does each Notification show,
// and is there a full Notification Feed page?
// State is in memory only: reload resets it. Example Notifications are fake but
// follow the six agreed events (map #2) and the click targets from ticket #7.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  Bell,
  CheckCheck,
  MessageSquare,
  Receipt,
  UserPlus,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { cn } from "~/lib/utils";

type Kind =
  | "refund-approved"
  | "refund-declined"
  | "staff-reply"
  | "new-question"
  | "new-enrollment"
  | "seat-claimed"
  | "open-refund";

export type ProtoNotification = {
  id: number;
  kind: Kind;
  text: string; // **bold** segments
  course: string;
  minutesAgo: number;
  href: string | null; // null = no destination, click only marks read
  read: boolean;
};

type Viewer = {
  role: "student" | "instructor" | "admin";
  isTeamAdmin: boolean;
};

const KIND_META: Record<
  Kind,
  { icon: React.ElementType; label: string; tone: string }
> = {
  "refund-approved": { icon: Receipt, label: "Refunds", tone: "text-emerald-600 bg-emerald-500/10" },
  "refund-declined": { icon: Receipt, label: "Refunds", tone: "text-rose-600 bg-rose-500/10" },
  "open-refund": { icon: Receipt, label: "Refunds", tone: "text-amber-600 bg-amber-500/10" },
  "staff-reply": { icon: MessageSquare, label: "Discussions", tone: "text-sky-600 bg-sky-500/10" },
  "new-question": { icon: MessageSquare, label: "Discussions", tone: "text-sky-600 bg-sky-500/10" },
  "new-enrollment": { icon: UserPlus, label: "Enrollments", tone: "text-violet-600 bg-violet-500/10" },
  "seat-claimed": { icon: UsersRound, label: "Team", tone: "text-teal-600 bg-teal-500/10" },
};

export function exampleNotifications(viewer: Viewer, lessonHref: string) {
  let id = 0;
  const n = (
    kind: Kind,
    text: string,
    course: string,
    minutesAgo: number,
    href: string | null,
    read = false
  ): ProtoNotification => ({ id: ++id, kind, text, course, minutesAgo, href, read });

  if (viewer.role === "instructor") {
    return [
      n("new-question", "**Sam Ortiz** asked a Discussion Question on **Hooks in depth**: “Why does useEffect run twice in dev?”", "React Patterns", 4, lessonHref),
      n("new-enrollment", "**Priya Shah** enrolled in **React Patterns**.", "React Patterns", 22, null),
      n("new-enrollment", "**Tom Becker** enrolled in **React Patterns**.", "React Patterns", 51, null),
      n("new-question", "**Lena Wu** asked a Discussion Question on **Generics**: “Can a generic default reference another generic?”", "Intro to TypeScript", 190, lessonHref, true),
      n("new-enrollment", "**Marco Rossi** enrolled in **Intro to TypeScript**.", "Intro to TypeScript", 60 * 26, null, true),
      n("new-enrollment", "**Aisha Khan** enrolled in **Intro to TypeScript**.", "Intro to TypeScript", 60 * 50, null, true),
    ];
  }
  if (viewer.role === "admin") {
    return [
      n("open-refund", "**Jordan Blake** opened a Refund Request for **React Patterns**: “Not what I expected from the description.”", "React Patterns", 7, "/admin/refunds"),
      n("open-refund", "**Northwind Ltd** (Team Admin **Chris Doe**) opened a Refund Request for a Team Licence of **Intro to TypeScript**.", "Intro to TypeScript", 95, "/admin/refunds"),
      n("open-refund", "**Ella Park** opened a Refund Request for **Advanced CSS**: “Bought the wrong course.”", "Advanced CSS", 60 * 30, "/admin/refunds", true),
    ];
  }
  const list = [
    n("staff-reply", "**Dana Lee** (Instructor) replied to your Discussion Question on **Generics**.", "Intro to TypeScript", 3, lessonHref),
    n("refund-declined", "Your Refund Request for **Advanced CSS** was declined: “You've watched most of the course.”", "Advanced CSS", 75, "/settings"),
    n("refund-approved", "Your Refund Request for **React Patterns** was approved. The full amount is on its way back to you.", "React Patterns", 60 * 27, null, true),
    n("staff-reply", "**Dana Lee** (Instructor) replied to your Discussion Question on **Mapped types**.", "Intro to TypeScript", 60 * 72, lessonHref, true),
  ];
  if (viewer.isTeamAdmin) {
    list.splice(
      1,
      0,
      n("seat-claimed", "**Alex Kim** claimed a Seat on your Team Licence for **Intro to TypeScript**. 7 of 10 Seats now claimed.", "Intro to TypeScript", 12, "/team"),
      n("seat-claimed", "**Bea Novak** claimed a Seat on your Team Licence for **Intro to TypeScript**. 6 of 10 Seats now claimed.", "Intro to TypeScript", 60 * 5, "/team", true)
    );
  }
  return list;
}

function liveExample(viewer: Viewer, lessonHref: string, id: number): ProtoNotification {
  const base = { id, minutesAgo: 0, read: false };
  if (viewer.role === "instructor")
    return { ...base, kind: "new-enrollment", text: "**Noah Fischer** enrolled in **React Patterns**.", course: "React Patterns", href: null };
  if (viewer.role === "admin")
    return { ...base, kind: "open-refund", text: "**Mia Torres** opened a Refund Request for **Intro to TypeScript**: “Course is too basic for me.”", course: "Intro to TypeScript", href: "/admin/refunds" };
  if (viewer.isTeamAdmin)
    return { ...base, kind: "seat-claimed", text: "**Omar Said** claimed a Seat on your Team Licence for **Intro to TypeScript**. 8 of 10 Seats now claimed.", course: "Intro to TypeScript", href: "/team" };
  return { ...base, kind: "staff-reply", text: "**Dana Lee** (Instructor) replied to your Discussion Question on **Generics**.", course: "Intro to TypeScript", href: lessonHref };
}

function ago(m: number) {
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 60 / 24)}d ago`;
}

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function KindIcon({ kind, size = "md" }: { kind: Kind; size?: "sm" | "md" }) {
  const { icon: Icon, tone } = KIND_META[kind];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        tone,
        size === "sm" ? "size-7" : "size-9"
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </div>
  );
}

// ---------- shared state hook ----------

export function useProtoFeed(viewer: Viewer, lessonHref: string) {
  const [items, setItems] = useState(() => exampleNotifications(viewer, lessonHref));
  const navigate = useNavigate();
  const unread = items.filter((i) => !i.read).length;

  function open(n: ProtoNotification) {
    setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (n.href) navigate(n.href);
  }
  function markAllRead() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
  }
  function simulate() {
    const n = liveExample(viewer, lessonHref, Date.now());
    setItems((xs) => [n, ...xs]);
    return n;
  }
  return { items, unread, open, markAllRead, simulate };
}

export type ProtoFeed = ReturnType<typeof useProtoFeed>;

export const VARIANTS = [
  { key: "A", name: "Bell + dropdown" },
  { key: "B", name: "Nav item + side drawer" },
  { key: "C", name: "Nav item + full page" },
];

export function useVariant() {
  const [sp] = useSearchParams();
  const v = sp.get("variant") ?? "A";
  return VARIANTS.some((x) => x.key === v) ? v : "A";
}

// Called when "Simulate live" is pressed; each variant announces arrival differently.
export function announce(variant: string, n: ProtoNotification) {
  if (variant === "B") {
    toast(<RichText text={n.text} />, { icon: <Bell className="size-4" /> });
  }
  // A: badge only. C: badge + "new" highlight in the list.
}

// ---------- Variant A: bell in the sidebar header, dropdown list ----------

export function VariantABell({ feed }: { feed: ProtoFeed }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        title="Notifications"
      >
        <Bell className="size-5" />
        {feed.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {feed.unread > 9 ? "9+" : feed.unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-full top-0 z-50 ml-3 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              <button
                onClick={feed.markAllRead}
                disabled={feed.unread === 0}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
              >
                Mark all read
              </button>
            </div>
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {feed.items.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No Notifications yet.
                </li>
              )}
              {feed.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      feed.open(n);
                      if (n.href) setOpen(false);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-accent",
                      n.read && "opacity-55",
                      !n.href && "cursor-default"
                    )}
                  >
                    <KindIcon kind={n.kind} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="leading-snug">
                        <RichText text={n.text} />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ago(n.minutesAgo)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Variant B: sidebar nav item, slide-over drawer with Unread/All ----------

export function VariantBNavItem({
  feed,
  onOpen,
}: {
  feed: ProtoFeed;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Bell className="size-4" />
      Notifications
      {feed.unread > 0 && (
        <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
          {feed.unread}
        </span>
      )}
    </button>
  );
}

export function VariantBDrawer({
  feed,
  open,
  onClose,
}: {
  feed: ProtoFeed;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const shown = tab === "unread" ? feed.items.filter((i) => !i.read) : feed.items;
  const today = shown.filter((i) => i.minutesAgo < 60 * 24);
  const earlier = shown.filter((i) => i.minutesAgo >= 60 * 24);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[26rem] flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-b px-5 py-2">
          {(["unread", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium capitalize",
                tab === t ? "bg-accent" : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {t}
              {t === "unread" && feed.unread > 0 ? ` (${feed.unread})` : ""}
            </button>
          ))}
          <button
            onClick={feed.markAllRead}
            disabled={feed.unread === 0}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-40"
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {shown.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {tab === "unread" ? "You're all caught up." : "No Notifications yet."}
            </p>
          )}
          {[
            ["Today", today],
            ["Earlier", earlier],
          ].map(([label, list]) =>
            (list as ProtoNotification[]).length === 0 ? null : (
              <section key={label as string} className="mb-4">
                <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {label as string}
                </h3>
                {(list as ProtoNotification[]).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      feed.open(n);
                      if (n.href) onClose();
                    }}
                    className={cn(
                      "flex w-full gap-3 rounded-lg p-3 text-left hover:bg-accent",
                      !n.read && "bg-primary/5",
                      n.read && "opacity-60"
                    )}
                  >
                    <KindIcon kind={n.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {KIND_META[n.kind].label} · {n.course}
                      </p>
                      <p className="mt-0.5 text-sm leading-snug">
                        <RichText text={n.text} />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ago(n.minutesAgo)}
                        {n.href ? "" : " · nothing to open"}
                      </p>
                    </div>
                  </button>
                ))}
              </section>
            )
          )}
        </div>
      </aside>
    </>
  );
}

// ---------- Variant C: sidebar nav item → full Notification Feed page ----------

export function VariantCNavItem({ feed }: { feed: ProtoFeed }) {
  const [sp, setSp] = useSearchParams();
  const active = sp.get("feed") === "1";
  return (
    <button
      onClick={() =>
        setSp((p) => {
          const q = new URLSearchParams(p);
          q.set("feed", "1");
          return q;
        })
      }
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <span className="relative">
        <Bell className="size-4" />
        {feed.unread > 0 && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-rose-600" />
        )}
      </span>
      Notifications
      {feed.unread > 0 && (
        <span className="ml-auto text-xs font-semibold text-rose-600">
          {feed.unread} new
        </span>
      )}
    </button>
  );
}

export function VariantCPage({ feed, liveIds }: { feed: ProtoFeed; liveIds: Set<number> }) {
  const labels = useMemo(
    () => ["All", ...new Set(feed.items.map((i) => KIND_META[i.kind].label))],
    [feed.items]
  );
  const [filter, setFilter] = useState("All");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const shown = feed.items.filter(
    (i) =>
      (filter === "All" || KIND_META[i.kind].label === filter) &&
      (!unreadOnly || !i.read)
  );
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {feed.unread} unread of {feed.items.length}
          </p>
        </div>
        <button
          onClick={feed.markAllRead}
          disabled={feed.unread === 0}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-40"
        >
          <CheckCheck className="size-4" /> Mark all read
        </button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {labels.map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >
            {l}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {shown.length === 0 && (
              <tr>
                <td className="py-16 text-center text-muted-foreground">Nothing here.</td>
              </tr>
            )}
            {shown.map((n) => (
              <tr
                key={n.id}
                className={cn(
                  "transition-colors",
                  liveIds.has(n.id) && !n.read && "bg-amber-500/10",
                  n.read && "text-muted-foreground"
                )}
              >
                <td className="w-12 py-3 pl-4">
                  <KindIcon kind={n.kind} size="sm" />
                </td>
                <td className="px-3 py-3">
                  <p className={cn("leading-snug", !n.read && "font-medium")}>
                    <RichText text={n.text} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {n.course} · {ago(n.minutesAgo)}
                    {liveIds.has(n.id) && !n.read && (
                      <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        New
                      </span>
                    )}
                  </p>
                </td>
                <td className="w-28 pr-4 text-right">
                  {n.href ? (
                    <button
                      onClick={() => feed.open(n)}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                    >
                      Open
                    </button>
                  ) : !n.read ? (
                    <button
                      onClick={() => feed.open(n)}
                      className="text-xs text-primary hover:underline"
                    >
                      Mark read
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SimulateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full bg-fuchsia-600 px-3 py-1 text-xs font-semibold hover:bg-fuchsia-500"
      title="Push a new Notification as if it arrived live"
    >
      <Zap className="size-3.5" /> Simulate live
    </button>
  );
}
