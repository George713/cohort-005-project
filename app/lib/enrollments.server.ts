import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { coupons, courses, enrollments, purchases, users } from "~/db/schema";
import { getSeatAvailability } from "~/lib/refunds.server";
import type { Notification } from "~/lib/notifications.server";

// ─── Enrollment and Seat claim ───
// The two ways a Student gets an Enrollment: buying a course for themselves
// (an Individual Purchase) and claiming a Seat on a Team Licence. Kept out of
// the routes so the rules can be tested against an in-memory database, and so
// the Notifications these events produce can be returned from here.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type Purchase = typeof purchases.$inferSelect;
type Enrollment = typeof enrollments.$inferSelect;

export type Failure = { ok: false; error: string };

export type PurchaseEnrollment =
  | {
      ok: true;
      purchase: Purchase;
      enrollment: Enrollment;
      notification: Notification;
    }
  | Failure;

/**
 * The Instructor's "new Enrollment" Notification. It has no destination and
 * carries the course id so Knock can batch per course, and the Student's name
 * so the batched row can name them.
 */
function buildEnrollmentNotification(
  db: Queryable,
  studentId: number,
  course: { id: number; title: string; instructorId: number },
  enrollmentId: number
): Notification {
  const student = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, studentId))
    .get();

  return {
    kind: "enrollment-new",
    recipients: [course.instructorId],
    actor: studentId,
    subjectId: enrollmentId,
    data: {
      studentName: student?.name ?? "A student",
      courseId: course.id,
      courseTitle: course.title,
    },
  };
}

function findEnrollment(
  db: Queryable,
  userId: number,
  courseId: number
): Enrollment | undefined {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/**
 * Records an Individual Purchase and gives the buyer their Enrollment. One
 * Enrollment per course, so a buyer who already has one is refused before
 * anything is written.
 */
export function enrollFromIndividualPurchase(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null
): PurchaseEnrollment {
  if (findEnrollment(db, buyerId, courseId)) {
    return { ok: false, error: "You are already enrolled in this course." };
  }

  const course = db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();

  if (!course) {
    return { ok: false, error: "Course not found." };
  }

  const purchase = db
    .insert(purchases)
    .values({ userId: buyerId, courseId, amountPaid, country })
    .returning()
    .get();

  const enrollment = db
    .insert(enrollments)
    .values({ userId: buyerId, courseId })
    .returning()
    .get();

  return {
    ok: true,
    purchase,
    enrollment,
    notification: buildEnrollmentNotification(
      db,
      buyerId,
      course,
      enrollment.id
    ),
  };
}

export type SeatClaim =
  | { ok: true; enrollment: Enrollment; notification: Notification }
  | Failure;

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

/**
 * Claims a Seat on a Team Licence for a Student, giving them an Enrollment.
 * Refused while the Team Licence has an Open Refund Request, once it has been
 * refunded, when the Seat is taken, and when the Student already has the
 * course. An unusable Seat stays unclaimed either way.
 */
export function claimSeat(
  db: Db,
  code: string,
  studentId: number,
  studentCountry: string
): SeatClaim {
  const seat = db
    .select()
    .from(coupons)
    .where(eq(coupons.code, code))
    .get();

  if (!seat) {
    return { ok: false, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, error: SEAT_REFUNDED };
  }

  if (findEnrollment(db, studentId, seat.courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== studentCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  const course = db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.id, seat.courseId))
    .get();

  if (!course) {
    return { ok: false, error: "Course not found." };
  }

  db.update(coupons)
    .set({
      redeemedByUserId: studentId,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.id, seat.id))
    .run();

  const enrollment = db
    .insert(enrollments)
    .values({ userId: studentId, courseId: seat.courseId })
    .returning()
    .get();

  return {
    ok: true,
    enrollment,
    notification: buildEnrollmentNotification(
      db,
      studentId,
      course,
      enrollment.id
    ),
  };
}
