import { data } from "react-router";
import { and, asc, eq, notExists } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  RefundStatus,
  UserRole,
  courses,
  enrollments,
  purchases,
  refunds,
  users,
} from "~/db/schema";
import { NOT_LOCKED, checkCountryLock, type CountryLock } from "./country-lock";

export type Db = BetterSQLite3Database<typeof schema>;

type User = typeof users.$inferSelect;
type Course = typeof courses.$inferSelect;

// getAccess never throws — the lesson page needs to render a paywall preview for
// signed-out and unenrolled visitors rather than erroring. The require* guards
// are built on it for the routes that should just reject.

export type Access = {
  userId: number | null;
  user: User | undefined;
  isAdmin: boolean;
  /** The instructor who owns this specific course. */
  isOwningInstructor: boolean;
  /** Owning instructor or admin — the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * Staff always can. Students need an Enrollment that no Country Lock keeps
   * them out of.
   */
  canViewContent: boolean;
};

const SIGNED_OUT: Access = {
  userId: null,
  user: undefined,
  isAdmin: false,
  isOwningInstructor: false,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

function signInRequired() {
  return data("Select a user from the DevUI panel.", { status: 401 });
}

function getUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getCourseById(db: Db, id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function isUserEnrolled(db: Db, userId: number, courseId: number) {
  return !!db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/** The Student's Purchases of the course that have no Approved Refund Request. */
function findUnrefundedPurchases(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          db
            .select()
            .from(refunds)
            .where(
              and(
                eq(refunds.purchaseId, purchases.id),
                eq(refunds.status, RefundStatus.Approved)
              )
            )
        )
      )
    )
    .orderBy(asc(purchases.id))
    .all();
}

// ADR-0013: refunded Purchases don't count, and one usable Purchase is enough.
// No counting Purchase (e.g. a Claimed Seat) means no lock.
function findCountryLock(
  db: Db,
  userId: number,
  course: Course,
  currentCountry: string | null
): CountryLock {
  const locks = findUnrefundedPurchases(db, userId, course.id).map((purchase) =>
    checkCountryLock(
      course.price,
      course.pppEnabled,
      purchase.country,
      currentCountry
    )
  );
  const everyPurchaseLocked =
    locks.length > 0 && locks.every((lock) => lock.locked);
  return everyPurchaseLocked ? locks[0] : NOT_LOCKED;
}

/**
 * Course Access bound to a database, deciding from plain values: who is asking
 * (a viewer id, or null when signed out), the country they're in now (or null
 * when unknown), and which course. The module's entry point binds the app
 * database; tests bind a test database.
 */
export function createCourseAccess(db: Db) {
  /**
   * Who the viewer is to this course and whether they may read its content.
   * Never throws: signed-out and unenrolled viewers get a result too, so the
   * lesson page can show a paywall preview. A viewer id with no matching user
   * is treated as signed out.
   */
  async function getAccess(
    viewerId: number | null,
    currentCountry: string | null,
    courseId: number
  ): Promise<Access> {
    if (!viewerId) return SIGNED_OUT;

    const user = getUserById(db, viewerId);
    if (!user) return SIGNED_OUT;

    const course = getCourseById(db, courseId);
    const isAdmin = user.role === UserRole.Admin;
    const isOwningInstructor = course?.instructorId === viewerId;
    const isStaff = isAdmin || isOwningInstructor;
    const enrolled = isUserEnrolled(db, viewerId, courseId);

    // Staff are exempt from the Country Lock (ADR-0009).
    const countryLock =
      enrolled && !isStaff && course
        ? findCountryLock(db, viewerId, course, currentCountry)
        : NOT_LOCKED;

    return {
      userId: viewerId,
      user,
      isAdmin,
      isOwningInstructor,
      isStaff,
      enrolled,
      pppBlocked: countryLock.locked,
      pppBlockedCountry: countryLock.currentCountry,
      pppPurchaseCountry: countryLock.purchaseCountry,
      canViewContent: isStaff || (enrolled && !countryLock.locked),
    };
  }

  /** Throws 401 unless someone is signed in. Returns their user id. */
  async function requireUserId(viewerId: number | null): Promise<number> {
    if (!viewerId) throw signInRequired();
    return viewerId;
  }

  /**
   * Throws 401 when signed out, 403 when the viewer can't see the course's
   * content.
   */
  async function requireContentAccess(
    viewerId: number | null,
    currentCountry: string | null,
    courseId: number
  ): Promise<Access> {
    const access = await getAccess(viewerId, currentCountry, courseId);

    if (!access.userId) throw signInRequired();

    if (!access.canViewContent) {
      throw data("You must be enrolled in this course.", { status: 403 });
    }

    return access;
  }

  /** Throws unless the viewer is the course's own Instructor, or a Platform Admin. */
  async function requireStaff(
    viewerId: number | null,
    currentCountry: string | null,
    courseId: number
  ): Promise<Access> {
    const access = await getAccess(viewerId, currentCountry, courseId);

    if (!access.userId) throw signInRequired();

    if (!access.isStaff) {
      throw data("Only this course's instructor can do that.", { status: 403 });
    }

    return access;
  }

  /**
   * Throws unless the viewer is an Instructor or a Platform Admin, without
   * tying them to a particular course.
   */
  async function requireInstructorOrAdmin(viewerId: number | null) {
    const userId = await requireUserId(viewerId);
    const user = getUserById(db, userId);

    if (
      !user ||
      (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
    ) {
      throw data("Only instructors can access this page.", { status: 403 });
    }

    return { userId, user, isAdmin: user.role === UserRole.Admin };
  }

  return {
    getAccess,
    requireUserId,
    requireContentAccess,
    requireStaff,
    requireInstructorOrAdmin,
  };
}
