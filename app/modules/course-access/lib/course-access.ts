import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { UserRole, courses, enrollments, purchases, users } from "~/db/schema";
import { checkCountryLock } from "./country-lock";

export type Db = BetterSQLite3Database<typeof schema>;

type User = typeof users.$inferSelect;

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
   * Staff always can. Students need an enrollment that isn't PPP-blocked.
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

const SIGN_IN_MESSAGE = "Select a user from the DevUI panel.";

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

function findPurchase(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
}

export function getAccess(
  db: Db,
  viewerId: number | null,
  currentCountry: string | null,
  courseId: number
): Access {
  if (!viewerId) return SIGNED_OUT;

  const user = getUserById(db, viewerId);
  if (!user) return SIGNED_OUT;

  const course = getCourseById(db, courseId);
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course?.instructorId === viewerId;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled = isUserEnrolled(db, viewerId, courseId);

  // The Country Lock only restricts enrolled Students — staff are exempt.
  let lock = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isStaff && course) {
    const purchase = findPurchase(db, viewerId, courseId);
    lock = checkCountryLock(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      currentCountry
    );
  }

  return {
    userId: viewerId,
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: lock.blocked,
    pppBlockedCountry: lock.blockedCountry,
    pppPurchaseCountry: lock.purchaseCountry,
    canViewContent: isStaff || (enrolled && !lock.blocked),
  };
}

export function requireUserId(viewerId: number | null): number {
  if (!viewerId) {
    throw data(SIGN_IN_MESSAGE, { status: 401 });
  }
  return viewerId;
}

export function requireContentAccess(
  db: Db,
  viewerId: number | null,
  currentCountry: string | null,
  courseId: number
): Access {
  const access = getAccess(db, viewerId, currentCountry, courseId);

  if (!access.userId) {
    throw data(SIGN_IN_MESSAGE, { status: 401 });
  }

  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }

  return access;
}

export function requireStaff(
  db: Db,
  viewerId: number | null,
  currentCountry: string | null,
  courseId: number
): Access {
  const access = getAccess(db, viewerId, currentCountry, courseId);

  if (!access.userId) {
    throw data(SIGN_IN_MESSAGE, { status: 401 });
  }

  if (!access.isStaff) {
    throw data("Only this course's instructor can do that.", { status: 403 });
  }

  return access;
}

export function requireInstructorOrAdmin(db: Db, viewerId: number | null) {
  const userId = requireUserId(viewerId);
  const user = getUserById(db, userId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return { userId, user, isAdmin: user.role === UserRole.Admin };
}
