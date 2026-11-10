import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { signUserToken } from "@knocklabs/node";

// ─── Notifications ───
// The one server seam to Knock. Every Notification Cadence sends goes through
// sendNotification, which picks the Knock workflow from the kind, drops the
// actor from the recipients, and never throws into the action that caused it.
// archiveNotifications retires every recipient's copy once its subject is
// decided, through Knock's bulk message update. Without KNOCK_SECRET_API_KEY
// (local dev, tests) both are written to .outbox/ as JSON instead, the same way
// the mailer works.

export type NotificationKind =
  | "refund-request-approved"
  | "refund-request-declined"
  | "discussion-reply-from-staff"
  | "discussion-question-new"
  | "enrollment-new"
  | "seat-claimed"
  | "refund-request-opened";

export type Notification = {
  kind: NotificationKind;
  /** Cadence user ids, before the actor is dropped. */
  recipients: number[];
  /** The Cadence user id who caused it. They never receive their own action. */
  actor: number;
  /** The id of the thing later archived with this Notification. */
  subjectId: number | string;
  /** Template data: the names, titles, decision note and url it needs. */
  data: Record<string, unknown>;
};

export type NotificationRecipient = { id: string };

/** A request to archive every recipient's copy of one subject's Notifications. */
export type ArchiveRequest = {
  workflow: NotificationKind;
  subjectId: number | string;
};

/** What a transport receives: ids only, ready for Knock. */
export type NotificationDelivery = {
  workflow: NotificationKind;
  recipients: NotificationRecipient[];
  actor: NotificationRecipient;
  subjectId: string;
  data: Record<string, unknown>;
};

/** What an archive transport receives: the workflow and subject id, as strings. */
export type NotificationArchive = {
  workflow: NotificationKind;
  subjectId: string;
};

export interface NotificationTransport {
  send(notification: NotificationDelivery): Promise<void>;
  archive(archive: NotificationArchive): Promise<void>;
}

const KNOCK_API_URL = "https://api.knock.app";
const KNOCK_PAGE_SIZE = 100;

function knockHeaders(secretKey: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${secretKey}`,
  };
}

type KnockMessage = {
  id: string;
  data?: Record<string, unknown> | null;
  archived_at?: string | null;
};

type KnockMessagePage = {
  items: KnockMessage[];
  page_info?: { after?: string | null };
};

/**
 * Every unarchived message Knock holds for this workflow and subject, across
 * recipients. Knock's public Messages API has no archive-by-subject call, so the
 * ids are found first and then archived in one batch.
 */
async function findKnockMessageIds(
  secretKey: string,
  archive: NotificationArchive
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;

  do {
    const query = new URLSearchParams({
      source: archive.workflow,
      // Knock filters on the single-level trigger data the message was made
      // with, so sendNotification puts the subject id there too.
      trigger_data: JSON.stringify({ subjectId: archive.subjectId }),
      page_size: String(KNOCK_PAGE_SIZE),
    });
    if (after) query.set("after", after);

    const response = await fetch(`${KNOCK_API_URL}/v1/messages?${query}`, {
      headers: knockHeaders(secretKey),
    });

    if (!response.ok) {
      throw new Error(
        `Knock rejected listing ${archive.workflow} messages: ${response.status}`
      );
    }

    const page = (await response.json()) as KnockMessagePage;

    for (const message of page.items) {
      if (message.archived_at) continue;
      if (String(message.data?.subjectId) !== archive.subjectId) continue;
      ids.push(message.id);
    }

    after = page.page_info?.after ?? null;
  } while (after);

  return ids;
}

export function knockTransport(secretKey: string): NotificationTransport {
  return {
    async send(notification) {
      const response = await fetch(
        `${KNOCK_API_URL}/v1/workflows/${notification.workflow}/trigger`,
        {
          method: "POST",
          headers: knockHeaders(secretKey),
          body: JSON.stringify({
            recipients: notification.recipients,
            actor: notification.actor,
            // The subject id rides along in the trigger data so archive can
            // find these messages later; templates never show it.
            data: { ...notification.data, subjectId: notification.subjectId },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Knock rejected ${notification.workflow}: ${response.status}`
        );
      }
    },

    async archive(archive) {
      const messageIds = await findKnockMessageIds(secretKey, archive);
      if (messageIds.length === 0) return;

      const response = await fetch(
        `${KNOCK_API_URL}/v1/messages/batch/archived`,
        {
          method: "POST",
          headers: knockHeaders(secretKey),
          body: JSON.stringify({ message_ids: messageIds }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Knock rejected archiving ${archive.workflow}: ${response.status}`
        );
      }
    },
  };
}

export function outboxTransport(directory: string): NotificationTransport {
  return {
    async send(notification) {
      mkdirSync(directory, { recursive: true });
      const file = join(
        directory,
        `${Date.now()}-${randomUUID()}-${notification.workflow}.json`
      );
      writeFileSync(file, JSON.stringify(notification, null, 2));
    },

    async archive(archive) {
      mkdirSync(directory, { recursive: true });
      const file = join(
        directory,
        `${Date.now()}-${randomUUID()}-${archive.workflow}-archived.json`
      );
      writeFileSync(
        file,
        JSON.stringify({ archived: true, ...archive }, null, 2)
      );
    },
  };
}

function defaultTransport(): NotificationTransport {
  const secretKey = process.env.KNOCK_SECRET_API_KEY;
  return secretKey ? knockTransport(secretKey) : outboxTransport(".outbox");
}

/**
 * Sends one Notification to every recipient but its actor. If that leaves
 * nobody, nothing is sent. A transport failure is logged and swallowed: a
 * Notification never fails the user's action.
 */
export async function sendNotification(
  notification: Notification,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  const recipientIds = notification.recipients
    .map(String)
    .filter((id) => id !== String(notification.actor))
    .map((id) => ({ id }));

  if (recipientIds.length === 0) return;

  try {
    await transport.send({
      workflow: notification.kind,
      recipients: recipientIds,
      actor: { id: String(notification.actor) },
      subjectId: String(notification.subjectId),
      data: notification.data,
    });
  } catch (error) {
    console.error(
      `Could not send the ${notification.kind} Notification.`,
      error
    );
  }
}

/**
 * Archives every recipient's copy of one subject's Notifications, through the
 * transport's bulk update. Best effort like sending: a failure is logged and
 * swallowed, so it never undoes the decision that triggered it.
 */
export async function archiveNotifications(
  archive: ArchiveRequest,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  try {
    await transport.archive({
      workflow: archive.workflow,
      subjectId: String(archive.subjectId),
    });
  } catch (error) {
    console.error(
      `Could not archive the ${archive.workflow} Notifications.`,
      error
    );
  }
}

// ─── Feed sign-in ───
export type FeedConfig = {
  publicApiKey: string;
  userId: string;
  userToken: string;
  feedChannelId: string;
};

const FEED_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * What the browser needs to sign in to the current user's Notification Feed.
 * Null when Knock is not configured: no bell is better than a broken one.
 */
export async function getFeedConfig(
  userId: number
): Promise<FeedConfig | null> {
  const publicApiKey = process.env.KNOCK_PUBLIC_API_KEY;
  const signingKey = process.env.KNOCK_SIGNING_KEY;
  const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID;

  if (!publicApiKey || !signingKey || !feedChannelId) return null;

  try {
    const userToken = await signUserToken(String(userId), {
      signingKey,
      expiresInSeconds: FEED_TOKEN_LIFETIME_SECONDS,
    });

    return {
      publicApiKey,
      userId: String(userId),
      userToken,
      feedChannelId,
    };
  } catch (error) {
    console.error("Could not sign the Notification Feed user token.", error);
    return null;
  }
}
