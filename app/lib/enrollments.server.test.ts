import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import {
  claimSeat,
  enrollFromIndividualPurchase,
  SEAT_ON_HOLD,
  SEAT_REFUNDED,
} from "./enrollments.server";
import {
  sendNotification,
  type NotificationDelivery,
  type NotificationTransport,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
});

function addLearner(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function isEnrolled(userId: number) {
  return !!db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .get();
}

function buyForSelf(userId: number) {
  const result = enrollFromIndividualPurchase(
    db,
    userId,
    base.course.id,
    7900,
    "US"
  );
  if (!result.ok) throw new Error(result.error);
  return result;
}

function purchaseCount() {
  return db.select().from(schema.purchases).all().length;
}

function collectDeliveries() {
  const deliveries: NotificationDelivery[] = [];
  const transport: NotificationTransport = {
    async send(delivery) {
      deliveries.push(delivery);
    },
  };
  return { deliveries, transport };
}

function buySeats(teamAdminId: number, seats: number, country = "US") {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: teamAdminId,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      country,
      createdAt: daysBefore(3),
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function getSeat(seatId: number) {
  const seat = db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, seatId))
    .get();
  if (!seat) throw new Error("Seat not found");
  return seat;
}

describe("an Individual Purchase", () => {
  it("gives the buyer an Enrollment", () => {
    const result = buyForSelf(base.user.id);

    expect(result.purchase).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
      country: "US",
    });
    expect(isEnrolled(base.user.id)).toBe(true);
  });

  it("returns a new-Enrollment Notification for the course's Instructor", () => {
    const result = buyForSelf(base.user.id);

    expect(result.notification).toMatchObject({
      kind: "enrollment-new",
      recipients: [base.instructor.id],
      actor: base.user.id,
      data: {
        studentName: base.user.name,
        courseId: base.course.id,
        courseTitle: base.course.title,
      },
    });
    expect(result.notification.data).not.toHaveProperty("url");
  });

  it("notifies nobody when the Instructor buys their own course", async () => {
    const result = enrollFromIndividualPurchase(
      db,
      base.instructor.id,
      base.course.id,
      7900,
      "US"
    );
    if (!result.ok) throw new Error(result.error);
    const { deliveries, transport } = collectDeliveries();

    await sendNotification(result.notification, transport);

    expect(deliveries).toHaveLength(0);
  });

  it("refuses a buyer who is already enrolled, recording no Purchase", () => {
    buyForSelf(base.user.id);

    const result = enrollFromIndividualPurchase(
      db,
      base.user.id,
      base.course.id,
      7900,
      "US"
    );

    expect(result.ok).toBe(false);
    expect(purchaseCount()).toBe(1);
  });
});

describe("claiming a Seat", () => {
  it("gives the Student an Enrollment and marks the Seat claimed", () => {
    const priya = addLearner("Priya");
    const { seats } = buySeats(priya.id, 2);

    const result = claimSeat(db, seats[0].code, base.user.id, "US");

    if (!result.ok) throw new Error(result.error);
    expect(result.enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(isEnrolled(base.user.id)).toBe(true);
    expect(getSeat(seats[0].id)).toMatchObject({
      redeemedByUserId: base.user.id,
    });
  });

  it("returns a new-Enrollment Notification for the course's Instructor", () => {
    const { seats } = buySeats(addLearner("Priya").id, 2);

    const result = claimSeat(db, seats[0].code, base.user.id, "US");

    if (!result.ok) throw new Error(result.error);
    expect(result.notification).toMatchObject({
      kind: "enrollment-new",
      recipients: [base.instructor.id],
      actor: base.user.id,
      data: {
        studentName: base.user.name,
        courseId: base.course.id,
        courseTitle: base.course.title,
      },
    });
    expect(result.notification.data).not.toHaveProperty("url");
  });

  it("refuses a Seat another Student already claimed", () => {
    const { seats } = buySeats(addLearner("Priya").id, 2);
    claimSeat(db, seats[0].code, addLearner("Ben").id, "US");

    const result = claimSeat(db, seats[0].code, base.user.id, "US");

    expect(result).toMatchObject({
      ok: false,
      error: "Coupon has already been redeemed",
    });
    expect(isEnrolled(base.user.id)).toBe(false);
    expect(getSeat(seats[0].id)).toMatchObject({
      redeemedByUserId: expect.any(Number),
    });
  });

  it("refuses while the Team Licence has an Open Refund Request", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    raiseRefundRequest(db, purchase.id, priya.id, "We changed plans.", NOW);

    const result = claimSeat(db, seats[0].code, base.user.id, "US");

    expect(result).toMatchObject({ ok: false, error: SEAT_ON_HOLD });
    expect(isEnrolled(base.user.id)).toBe(false);
    expect(getSeat(seats[0].id).redeemedByUserId).toBeNull();
  });

  it("refuses once the Team Licence has been refunded", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const raised = raiseRefundRequest(
      db,
      purchase.id,
      priya.id,
      "We changed plans.",
      NOW
    );
    if (!raised.ok) throw new Error(raised.error);
    approveRefundRequest(db, raised.refundRequestId, platformAdmin.id, null, NOW);

    const result = claimSeat(db, seats[0].code, base.user.id, "US");

    expect(result).toMatchObject({ ok: false, error: SEAT_REFUNDED });
    expect(isEnrolled(base.user.id)).toBe(false);
  });

  it("refuses a Student who already has the course, leaving the Seat unclaimed", () => {
    const { seats } = buySeats(addLearner("Priya").id, 2);
    buyForSelf(base.user.id);

    const result = claimSeat(db, seats[0].code, base.user.id, "US");

    expect(result).toMatchObject({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(getSeat(seats[0].id).redeemedByUserId).toBeNull();
  });

  it("refuses a Student outside the buyer's country", () => {
    const { seats } = buySeats(addLearner("Priya").id, 2, "US");

    const result = claimSeat(db, seats[0].code, base.user.id, "IN");

    expect(result).toMatchObject({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expect(isEnrolled(base.user.id)).toBe(false);
    expect(getSeat(seats[0].id).redeemedByUserId).toBeNull();
  });

  it("refuses a code that is not a Seat", () => {
    expect(claimSeat(db, "NOT-A-SEAT", base.user.id, "US")).toMatchObject({
      ok: false,
      error: "Coupon not found",
    });
  });
});
