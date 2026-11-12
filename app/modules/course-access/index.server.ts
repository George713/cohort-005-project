import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import * as courseAccessLib from "./lib/course-access";
import type { Access, Db } from "./lib/course-access";

export type { Access } from "./lib/course-access";

/**
 * Course Access bound to a database, deciding from plain values: who is asking
 * (a viewer id, or null when signed out), the country they're in now (or null
 * when unknown), and which course. The app uses the request-taking functions
 * below, which read the app database; tests build their own against a test
 * database.
 */
export function createCourseAccess(database: Db) {
  return {
    /**
     * Who the viewer is to this course and whether they may read its content.
     * Never throws: signed-out and unenrolled viewers get a result too, so the
     * lesson page can show a paywall preview. A viewer id with no matching
     * user is treated as signed out.
     */
    async getAccess(
      viewerId: number | null,
      currentCountry: string | null,
      courseId: number
    ): Promise<Access> {
      return courseAccessLib.getAccess(
        database,
        viewerId,
        currentCountry,
        courseId
      );
    },

    /** Throws 401 unless someone is signed in. Returns their user id. */
    async requireUserId(viewerId: number | null): Promise<number> {
      return courseAccessLib.requireUserId(viewerId);
    },

    /**
     * Throws 401 when signed out, 403 when the viewer can't see the course's
     * content.
     */
    async requireContentAccess(
      viewerId: number | null,
      currentCountry: string | null,
      courseId: number
    ): Promise<Access> {
      return courseAccessLib.requireContentAccess(
        database,
        viewerId,
        currentCountry,
        courseId
      );
    },

    /** Throws unless the viewer is the course's own Instructor, or a Platform Admin. */
    async requireStaff(
      viewerId: number | null,
      currentCountry: string | null,
      courseId: number
    ): Promise<Access> {
      return courseAccessLib.requireStaff(
        database,
        viewerId,
        currentCountry,
        courseId
      );
    },

    /**
     * Throws unless the viewer is an Instructor or a Platform Admin, without
     * tying them to a particular course.
     */
    async requireInstructorOrAdmin(viewerId: number | null) {
      return courseAccessLib.requireInstructorOrAdmin(database, viewerId);
    },
  };
}

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
  return courseAccess.requireInstructorOrAdmin(
    await getCurrentUserId(request)
  );
}
