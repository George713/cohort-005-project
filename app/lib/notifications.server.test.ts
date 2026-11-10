import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeNotificationTransport } from "~/test/setup";
import {
  archiveNotifications,
  getFeedConfig,
  outboxTransport,
  sendNotification,
  type Notification,
  type NotificationTransport,
} from "./notifications.server";

const notification: Notification = {
  kind: "refund-request-opened",
  recipients: [1, 2, 3],
  actor: 2,
  subjectId: 42,
  data: {
    buyerName: "Jordan Blake",
    courseTitle: "React Patterns",
    reason: "Not what I expected.",
    url: "/admin/refunds",
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendNotification", () => {
  it("drops the actor from the recipients", async () => {
    const fake = fakeNotificationTransport();

    await sendNotification(notification, fake.transport);

    expect(fake.sent[0].recipients).toEqual([{ id: "1" }, { id: "3" }]);
  });

  it("sends nothing when the actor is the only recipient", async () => {
    const fake = fakeNotificationTransport();

    await sendNotification(
      { ...notification, recipients: [notification.actor] },
      fake.transport
    );

    expect(fake.sent).toHaveLength(0);
  });

  it("sends recipients as id-only objects and keeps the actor and data", async () => {
    const fake = fakeNotificationTransport();

    await sendNotification(notification, fake.transport);

    expect(fake.sent[0]).toMatchObject({
      kind: "refund-request-opened",
      recipients: [{ id: "1" }, { id: "3" }],
      actor: { id: "2" },
      data: notification.data,
    });
  });

  it("writes the Notification as JSON to the outbox when Knock isn't configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "outbox-"));

    await sendNotification(notification, outboxTransport(directory));

    const files = readdirSync(directory);
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
    expect(written).toMatchObject({
      kind: "refund-request-opened",
      recipients: [{ id: "1" }, { id: "3" }],
      actor: { id: "2" },
      data: notification.data,
    });
  });

  it("logs a transport failure and resolves without throwing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenTransport: NotificationTransport = {
      async send() {
        throw new Error("Knock is down");
      },
      async archive() {
        throw new Error("Knock is down");
      },
    };

    await expect(
      sendNotification(notification, brokenTransport)
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });
});

describe("archiveNotifications", () => {
  it("asks the transport to archive the kind's copies of the subject", async () => {
    const fake = fakeNotificationTransport();

    await archiveNotifications(
      { kind: "refund-request-opened", subjectId: 42 },
      fake.transport
    );

    expect(fake.archived).toEqual([
      { kind: "refund-request-opened", subjectId: 42 },
    ]);
  });

  it("writes the archive to the outbox when Knock isn't configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "outbox-"));

    await archiveNotifications(
      { kind: "refund-request-opened", subjectId: 42 },
      outboxTransport(directory)
    );

    const files = readdirSync(directory);
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
    expect(written).toMatchObject({
      archived: true,
      kind: "refund-request-opened",
      subjectId: 42,
    });
  });

  it("logs a transport failure and resolves without throwing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenTransport: NotificationTransport = {
      async send() {},
      async archive() {
        throw new Error("Knock is down");
      },
    };

    await expect(
      archiveNotifications(
        { kind: "refund-request-opened", subjectId: 42 },
        brokenTransport
      )
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });
});

describe("getFeedConfig", () => {
  it("returns null and warns once when the Feed is not configured", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(getFeedConfig(1)).resolves.toBeNull();
    await expect(getFeedConfig(2)).resolves.toBeNull();

    expect(warned).toHaveBeenCalledTimes(1);
  });
});
