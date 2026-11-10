import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { signUserToken } from "@knocklabs/node";

// ─── Notifications ───
// The one server seam to Knock. Every Notification Cadence sends goes through
// sendNotification, which picks the Knock workflow from the kind, drops the
// actor from the recipients, and never throws into the action that caused it.
// Without KNOCK_SECRET_API_KEY (local dev, tests) each delivery is written to
// .outbox/ as JSON instead, the same way the mailer works.

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

/** What a transport receives: ids only, ready for Knock. */
export type NotificationDelivery = {
  workflow: NotificationKind;
  recipients: NotificationRecipient[];
  actor: NotificationRecipient;
  subjectId: string;
  data: Record<string, unknown>;
};

export interface NotificationTransport {
  send(notification: NotificationDelivery): Promise<void>;
}

const KNOCK_API_URL = "https://api.knock.app";

export function knockTransport(secretKey: string): NotificationTransport {
  return {
    async send(notification) {
      const response = await fetch(
        `${KNOCK_API_URL}/v1/workflows/${notification.workflow}/trigger`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${secretKey}`,
          },
          body: JSON.stringify({
            recipients: notification.recipients,
            actor: notification.actor,
            data: notification.data,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Knock rejected ${notification.workflow}: ${response.status}`
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
