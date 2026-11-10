# What do in-app notification services do that's worth paying for?

Research for [#4](https://github.com/George713/cohort-005-project/issues/4), part of the In-app Notifications map ([#2](https://github.com/George713/cohort-005-project/issues/2)).
Sources read on 2026-11-10. Prices change often, so check the linked pricing page before you commit.

Scope: **in-app** Notifications that appear live, without a page refresh. Email, push, SMS and preferences are out of scope. They are only noted where they affect lock-in or a later upgrade.

## TL;DR

- Every candidate does the same core job. You call one server API ("Notify these Students that X happened"). The service stores one inbox entry per recipient, keeps read/seen/archived state for each, and pushes new entries to the open browser tab over a WebSocket. You also get a drop-in React bell + inbox.
- Five things are worth paying for, compared with building it on Cadence's stack:
  1. **The live connection.** A hosted WebSocket that handles auth, reconnects and multiple tabs. Cadence has no socket server today, and SQLite can't broadcast changes between server processes.
  2. **Per-recipient state.** Seen, read and archived for each person, unread counts, "mark all read", pagination, and sync across devices.
  3. **A ready-made inbox UI.** Bell, badge, popover, and an infinite-scroll list with theming and custom row renderers.
  4. **Batching and digests.** "5 new Students enrolled" instead of five Notifications. This needs a timer/job runner that Cadence doesn't have.
  5. **A cheap path to email/push later.** The same trigger call can fan out to more channels without changing app code.
- **Shortlist: Knock, Courier, Novu.** Knock has the most polished in-app feed and keeps feed messages with no limit on the free plan. Courier has the same free volume and no big price jump after it. Novu is the only open-source option, but its free plan keeps in-app messages for only **24 hours**.
- **Drop:** Stream (no prebuilt notification UI, no SSR, first paid tier $499/mo) and MagicBell (1,000 free deliveries, then $249/mo). SuprSend is a capable runner-up, but batching sits behind its $250/mo plan.

## What "doing it ourselves" would mean on Cadence's stack

This section is our own analysis of the Cadence stack, not a vendor claim. It lists what each service takes off our hands.

| Hard part | Building it on React Router 8 + one SQLite file | What the services give you |
| --- | --- | --- |
| Live delivery | Add an SSE or WebSocket endpoint that the server keeps open for every signed-in tab. You need auth on the stream, heartbeats, reconnects, and replay of anything missed while disconnected. SQLite has no LISTEN/NOTIFY, so once Cadence runs more than one server process you need extra pub/sub (Redis or similar) to reach the right process. | A hosted WebSocket. The client SDK connects, reconnects and syncs tabs (Knock even offers a cross-tab BroadcastChannel). |
| Fan-out | One event (for example, a new Lesson published) can mean one row per enrolled Student, written inside the request or a background job. | One trigger call with a recipient list. Knock accepts up to 1,000 recipients per call. The service writes and delivers the per-recipient copies. |
| State | Per-recipient `seen_at` / `read_at` / `archived_at` columns, unread-count queries, bulk updates, pagination, retention cleanup. | Built in and exposed through the client SDK (see the table below). |
| UI | Bell, badge, popover, list, empty states, infinite scroll, dark mode, accessibility. | Drop-in React components plus headless hooks if you want your own UI. |
| Batching/digests | A scheduler or job queue to hold events and release them after a time window. Cadence has none. | A workflow "batch" or "digest" step you configure in a dashboard. |
| Scaling | Long-lived connections on the same servers that render pages. | The vendor carries that load. |

## Candidates in detail

### Knock

- **Storage & retention:** feed retention "No limit, but can be configured". Logs are kept 30 days on Free/Starter. ([pricing](https://knock.app/pricing))
- **Live delivery:** WebSocket, no infrastructure to set up. The React SDK has `auto_manage_socket_connection` and an experimental BroadcastChannel cross-tab sync. ([in-app overview](https://docs.knock.app/in-app-ui/overview), [React feed](https://docs.knock.app/in-app-ui/react/feed))
- **React UI:** `KnockProvider`, `KnockFeedProvider`, `NotificationIconButton`, `NotificationFeedPopover`, `NotificationFeed`, `NotificationCell`. You can customise with `renderItem`, CSS variables (`--rnf-*`), `colorMode="dark"` and i18n. Headless hooks are also available. ([React feed](https://docs.knock.app/in-app-ui/react/feed))
- **States:** seen, read, interacted, archived, and you can filter by each. Items are marked seen when the popover opens by default. `feedClient.markAsRead(items)` handles bulk updates. ([feeds overview](https://docs.knock.app/in-app-ui/feeds/overview))
- **Batching:** a batch step per recipient, with an optional batch key (for example by event type + actor). Windows can be fixed, dynamic or relative, up to 90 days. Templates see the first or last 10 activities by default. ([batch function](https://docs.knock.app/designing-workflows/batch-function))
- **Tenants:** pass `tenant` on trigger to scope feeds. No limits. Per-tenant branding/preferences are Enterprise-only, and tenants nest one level. ([tenants](https://docs.knock.app/concepts/tenants))
- **Server SDK:** `@knocklabs/node`, `knock.workflows.trigger(key, { recipients, actor, tenant, data })`. ([knock-node](https://github.com/knocklabs/knock-node), [v1 migration](https://docs.knock.app/developer-tools/migration-guides/node))
- **Pricing:** Free is $0 for 10,000 messages/mo, with no hard cap. Starter is $250/mo for 50,000, then $0.005 each. Unit: one message to one user on one channel, so in-app + email = 2. Only sent messages are billed, not triggers. ([pricing](https://knock.app/pricing))
- **Self-host / open source:** none. The client SDKs are public on GitHub.

### Courier

- **Storage & retention:** messages stay "until it is archived or expires" (optional `expiresAt`). No fixed retention is stated. ([how the inbox behaves](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md))
- **Live delivery:** WebSocket, opened by `listenForUpdates()`. Read/opened/archived state syncs across devices. ([courier-react](https://www.courier.com/docs/sdk-libraries/courier-react-web.md))
- **React UI:** `@trycourier/courier-react` (React 18+) ships `<CourierInbox />`, `<CourierInboxPopupMenu />`, `<CourierToast />` and `<CourierPreferences />`. You can theme it (`CourierInboxTheme`, light/dark), use custom renderers, or build a fully custom UI on `useCourier()`. ([courier-react](https://www.courier.com/docs/sdk-libraries/courier-react-web.md), [in-app overview](https://www.courier.com/docs/in-app/overview.md))
- **States:** `read`, `opened` and `archived` timestamps, plus `unreadCount`. We did not find a bulk "mark all read" in the pages we read.
- **Batching:** a Batch node (release by count or wait window), "Add to digest", and digest schedules (instant → monthly, IANA timezone). ([daily digest guide](https://www.courier.com/docs/guides/send-a-daily-digest.md))
- **Tenants:** a tenant carries brand, preferences and templates, and nests up to 4 levels. Tenant-scoped inbox messages are only visible when the client signs in with that `tenantId`. ([tenants](https://www.courier.com/docs/tenants/overview.md))
- **Server SDK:** `@trycourier/courier`, `client.send.message(...)`. ([docs index](https://www.courier.com/docs/llms.txt))
- **Pricing:** Developer is free for 10,000 sends/mo. Business is pay-as-you-go at $0.005 per send, with no monthly minimum listed. Billing is by notifications sent, not seats or channels. ([pricing](https://www.courier.com/pricing)) This is the smoothest price curve of the shortlist: there's no jump from $0 to $250.
- **Self-host / open source:** none (Courier hosts the Inbox). Templates and journeys live in the workspace. Courier publishes migration guides *from* Knock, Novu and SuprSend, which suggests switching between these vendors is routine.

### Novu

- **Storage & retention:** feed retention is **24 hours on Free**, 7 days on Pro, and 90 days on Team. ([pricing](https://novu.co/pricing), [billing](https://docs.novu.co/platform/account/billing)) For an inbox people revisit, the free plan is effectively a trial.
- **Live delivery:** WebSocket. Cloud uses PartySocket, self-hosted uses socket.io. ([JS SDK](https://docs.novu.co/platform/sdks/javascript))
- **React UI:** `Inbox`, `Bell`, `Notifications`, `InboxContent`, `Preferences`. Customisation is the deepest of the group: `appearance` (variables, per-element styles, base theme, icons) and render props (`renderBell`, `renderNotification`, `renderSubject`, `renderBody`...). Headless hooks are in `@novu/react`. ([React SDK](https://docs.novu.co/platform/sdks/react), [inbox overview](https://docs.novu.co/platform/inbox/overview))
- **States:** read, seen, archived and snoozed (snooze is Cloud only). Bulk actions: `readAll`, `seenAll`, `archiveAll`, `archiveAllRead`, `deleteAll`.
- **Digests:** a digest step grouped by subscriber plus one payload key, with regular or scheduled windows. The maximum window is 1 day on Free, 7 on Pro, and 30 on Team. ([digest](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest))
- **Tenants:** a `context` such as `tenant: { id, data }` filters the inbox. ([JS SDK](https://docs.novu.co/platform/sdks/javascript), [contexts](https://docs.novu.co/platform/workflow/advanced-features/contexts))
- **Server SDK:** `@novu/api`, `novu.trigger({ workflowId, to, payload })`. ([trigger](https://docs.novu.co/platform/workflow/trigger-workflow), [npm](https://www.npmjs.com/package/@novu/api))
- **Pricing:** Free is 10,000 workflow runs/mo and returns HTTP 402 when over. Pro starts at $30/mo for 30,000+ runs. Team starts at $250/mo for 250,000+. Unit: one workflow run per subscriber, and messages/channels aren't billed. ([billing](https://docs.novu.co/platform/account/billing))
- **Self-host / open source:** the core is MIT, and the `/enterprise` folder is commercial. 40k+ GitHub stars. The self-hosted version includes the Inbox, digest and all channels, but drops snooze, RBAC, SSO, and more, and caps team members at 1. It needs MongoDB, two Redis clusters, S3, and at least 4 vCPU / 8 GB. ([repo](https://github.com/novuhq/novu), [self-hosted vs cloud](https://docs.novu.co/community/self-hosted-and-novu-cloud.md), [self-hosting](https://docs.novu.co/community/self-hosting-novu/overview)) This is the strongest lock-in escape hatch, but running it is far heavier than Cadence's one SQLite file.

### SuprSend

- **Live delivery:** a socket connection with explicit status (`ONLINE`, `CONNECTING`, `DEGRADED`, `OFFLINE`...). The docs don't name the transport. ([React feed](https://docs.suprsend.com/docs/react-in-app-feed.md))
- **React UI:** `@suprsend/react` provides `Inbox` (bell + badge + popover, tabs via `stores`), with replaceable bell, badge, notification and header components, plus a theme. Headless hooks (`useFeed`, `useFeedData`...) are available. **No toasts**: you build those yourself.
- **States:** `seen_on`, `read_on`, `interacted_on`, `archived`, `is_pinned`. `markAllRead` is available.
- **Batching:** batch node (fixed/dynamic/relative window, batch key, retains 1–100 events) and digest node (recurring schedule, recipient timezone, minimum trigger count). ([batch](https://docs.suprsend.com/docs/batch.md), [digest](https://docs.suprsend.com/docs/digest.md)) **Batching is only on the Business plan ($250/mo).**
- **Tenants:** per-tenant branding, preferences and feeds, nesting to 5 levels. Multi-tenancy is Enterprise, or an add-on to Business. ([tenants](https://docs.suprsend.com/docs/tenants.md))
- **Server SDK:** `@suprsend/node-sdk`, `client.workflows.trigger(...)`. ([Node SDK](https://docs.suprsend.com/docs/integrate-node-sdk.md))
- **Pricing:** Free is 10k notifications/mo, with SuprSend branding on the feed. Essentials is $100/mo for 50k and removes branding. Business is $250/mo for 50k plus batching. A batch/digest counts as one notification. ([pricing](https://www.suprsend.com/pricing))
- **Self-host:** yes, self-hosted or BYOC, but Enterprise only. It runs on Kubernetes + Postgres + ClickHouse + Redis + NATS. ([self-hosted](https://docs.suprsend.com/docs/self-hosted/introduction.md))

### Stream (Activity Feeds v3)

- **Fit:** Stream is a social activity-feed engine with a notification feed type, not a notification service. It has seen/read tracking, `mark_all_read`/`mark_all_seen`, unread/unseen counts, and automatic aggregation (grouping by target/type/day). Realtime runs over WebSocket. ([notification feeds](https://getstream.io/activity-feeds/docs/react/notification-feeds/))
- **React:** `@stream-io/feeds-react-sdk` is hooks only, with **no prebuilt notification UI**. The "UI kit" is Sketch design files. **SSR isn't supported**, so it must render client-side only. ([React docs](https://getstream.io/activity-feeds/docs/react/))
- **Server SDK:** `@stream-io/node-sdk`. ([Node install](https://getstream.io/activity-feeds/docs/node/installation/))
- **Pricing:** the Build plan is free for 125k API calls + 5k activities/mo, with no overage allowed. Start is $499/mo billed annually. A Maker programme is free for very small companies. ([pricing](https://getstream.io/activity-feeds/pricing/), [maker](https://getstream.io/maker-account/))
- **Verdict:** wrong shape for us. You'd still build the inbox UI, there's no workflow/batching layer beyond aggregation, and email/push isn't included. Out of scope too: the map rules out an activity feed.

### MagicBell

- **React UI:** `@magicbell/react` provides `FloatingInbox`, `Inbox`, `InlineNotification`, `ToastContainer` and `UserPreferences`. Customise with CSS variables, a custom `ItemComponent`, or `react-headless`. ([React docs](https://www.magicbell.com/docs/libraries/magicbell-react))
- **States:** read, seen, archived. ([notification](https://www.magicbell.com/docs/primitive/notification))
- **Pricing:** Builder is free for **1,000** deliveries/mo. Startup is $249/mo for 50,000, then $0.0025 each. Deliveries are counted per user per channel. ([pricing](https://www.magicbell.com/pricing))
- **Gaps:** we didn't confirm the realtime transport, retention or batching from its docs. There's no self-hosting, and the backend isn't open source as far as we can tell ([GitHub org](https://github.com/magicbell)).
- **Verdict:** the free tier is too small, and the first paid step is as steep as Knock's without Knock's depth.

### Others seen

- **Engagespot** has a free React inbox component (`@engagespot/react-component`) and a free sign-up, but we couldn't find public pricing limits. ([React quick start](https://docs.engagespot.co/docs/sdks-n-libraries/frontend/react/quick-start/)) It's a niche option and we didn't evaluate it further.

## Comparison

| | Knock | Courier | Novu | SuprSend | Stream | MagicBell |
| --- | --- | --- | --- | --- | --- | --- |
| Live transport | WebSocket | WebSocket | WebSocket (PartySocket / socket.io) | Socket (transport unstated) | WebSocket | not confirmed |
| Prebuilt React inbox | Yes | Yes (+ toast) | Yes, deepest theming | Yes (no toast) | **No**, hooks only | Yes (+ toast) |
| Headless hooks | Yes | Yes | Yes | Yes | Yes | Yes |
| Seen / read / archived | ✓ / ✓ / ✓ | opened / ✓ / ✓ | ✓ / ✓ / ✓ (+ snooze) | ✓ / ✓ / ✓ | ✓ / ✓ / – | ✓ / ✓ / ✓ |
| Batching / digest | Yes, all plans | Yes | Yes (window capped by plan) | Business plan only | Aggregation only | not confirmed |
| In-app retention | No limit | Until archived/expired | **24 h free**, 7 d Pro, 90 d Team | not stated | not stated | not stated |
| Free tier | 10k msgs/mo | 10k sends/mo | 10k runs/mo | 10k notifs/mo (branded) | 5k activities/mo | 1k deliveries/mo |
| First paid tier | $250/mo (50k) | $0.005/send, pay-as-you-go | $30/mo (30k+) | $100/mo (50k, unbranded) | $499/mo | $249/mo (50k) |
| Node SDK | `@knocklabs/node` | `@trycourier/courier` | `@novu/api` | `@suprsend/node-sdk` | `@stream-io/node-sdk` | `magicbell-js` |
| Self-host / OSS | No | No | **Yes, MIT core** | Enterprise only | No | No |
| Email/push later | Same workflow | Same send | Same workflow | Same workflow | Not included | Same API |

## Lock-in

- **Triggers are thin.** Every vendor is one `trigger(workflow, recipients, data)` call from our server. If Cadence wraps it behind one `notify()` function, switching vendors means rewriting that one function plus the inbox component.
- **The sticky parts are workflows/templates (configured in the vendor dashboard) and stored inbox history.** Knock, SuprSend and Novu can keep workflows in code or Git. Stream offers S3 backups. None of the pages we read promised a simple inbox-history export, so ask before signing.
- **The UI is the biggest swap cost.** If Cadence uses a vendor's drop-in components, switching means replacing the UI. Building our own UI on headless hooks keeps Cadence's look but costs more up front.
- **Novu is the only one we could self-host if the vendor relationship went wrong**, though it needs MongoDB and Redis, not SQLite.

## Adding email/push later

All candidates except Stream treat in-app as one channel among email, push, SMS and chat. Adding email later means adding a step to the same workflow and connecting a provider (for example SendGrid), with no change to Cadence's trigger code. Watch the billing: every vendor here counts each channel separately (in-app + email = 2 messages), so the free tier runs out twice as fast once email is on.

## Open questions for the PRD

- Expected Notification volume per month. Every free tier is about 10k messages, which is roughly 330/day across all recipients. Fan-out events (for example, notifying every enrolled Student) eat this fast.
- How long Notifications must be kept (the map lists this under "not yet specified"). It rules out Novu Free and pushes Novu users to at least Pro.
- Drop-in UI vs headless hooks: this decides how much the UI ticket owes the prototype.
- Do Teams need tenant-scoped inboxes? A Team Admin who is also a Student elsewhere is the case where tenant scoping matters.
