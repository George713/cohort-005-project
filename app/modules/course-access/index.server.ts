import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { createCourseAccess, type Access } from "./lib/course-access";

export { createCourseAccess } from "./lib/course-access";
export type { Access } from "./lib/course-access";

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
const courseAccess = /* @__PURE__ */ createCourseAccess(db);

// ─── Request-taking entry points for routes ───
// These only turn a request into values: the viewer from the session and the
// country, resolved on every call.

export async function getAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  return courseAccess.getAccess(
    await getCurrentUserId(request),
    await resolveCountry(request),
    courseId
  );
}

/** Throws 401 unless someone is signed in. Returns their user id. */
export async function requireUserId(request: Request): Promise<number> {
  return courseAccess.requireUserId(await getCurrentUserId(request));
}

/**
 * Throws 401 when signed out, 403 when the user can't see the course's content.
 * Use in actions — loader guards don't protect actions.
 */
export async function requireContentAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  return courseAccess.requireContentAccess(
    await getCurrentUserId(request),
    await resolveCountry(request),
    courseId
  );
}

/** Throws unless the user is the course's own instructor, or an admin. */
export async function requireStaff(
  request: Request,
  courseId: number
): Promise<Access> {
  return courseAccess.requireStaff(
    await getCurrentUserId(request),
    await resolveCountry(request),
    courseId
  );
}

/**
 * Throws unless the user is an instructor or an admin, without tying them to a
 * particular course — for pages that span all of someone's courses.
 */
export async function requireInstructorOrAdmin(request: Request) {
  return courseAccess.requireInstructorOrAdmin(await getCurrentUserId(request));
}
