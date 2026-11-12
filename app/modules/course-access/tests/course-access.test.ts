import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { createCourseAccess } from "../index.server";

let db: TestDb;
let access: ReturnType<typeof createCourseAccess>;
let student: typeof schema.users.$inferSelect;
let instructor: typeof schema.users.$inferSelect;
let course: typeof schema.courses.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  const base = seedBaseData(db);
  student = base.user;
  instructor = base.instructor;
  course = base.course;
  access = createCourseAccess(db);
});

/** Runs a guard expected to throw a framework data response; returns it. */
async function thrown(guard: () => Promise<unknown>) {
  try {
    await guard();
  } catch (error) {
    return error as { data: unknown; init: { status: number } | null };
  }
  throw new Error("Expected the guard to throw");
}

describe("who is asking", () => {
  it("signed out: everything is false and the guards throw 401", async () => {
    expect(await access.getAccess(null, "US", course.id)).toEqual({
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
    });

    for (const guard of [
      () => access.requireUserId(null),
      () => access.requireContentAccess(null, "US", course.id),
      () => access.requireStaff(null, "US", course.id),
      () => access.requireInstructorOrAdmin(null),
    ]) {
      const response = await thrown(guard);
      expect(response.init?.status).toBe(401);
      expect(response.data).toBe("Select a user from the DevUI panel.");
    }
  });

  it("treats a viewer id with no matching user as signed out", async () => {
    const result = await access.getAccess(9999, "US", course.id);
    expect(result.userId).toBeNull();
    expect(result.canViewContent).toBe(false);

    const response = await thrown(() =>
      access.requireContentAccess(9999, "US", course.id)
    );
    expect(response.init?.status).toBe(401);
  });

  it("lets a Platform Admin who isn't enrolled view content and moderate", async () => {
    const admin = addUser("Pat Admin", schema.UserRole.Admin);

    const result = await access.requireStaff(admin.id, "US", course.id);
    expect(result).toMatchObject({
      userId: admin.id,
      isAdmin: true,
      isOwningInstructor: false,
      isStaff: true,
      enrolled: false,
      canViewContent: true,
    });
    await expect(
      access.requireContentAccess(admin.id, "US", course.id)
    ).resolves.toMatchObject({ canViewContent: true });
  });

  it("lets the course's own Instructor, not enrolled, view content and moderate", async () => {
    const result = await access.requireStaff(instructor.id, "US", course.id);
    expect(result).toMatchObject({
      userId: instructor.id,
      isAdmin: false,
      isOwningInstructor: true,
      isStaff: true,
      enrolled: false,
      canViewContent: true,
    });
    await expect(
      access.requireContentAccess(instructor.id, "US", course.id)
    ).resolves.toMatchObject({ canViewContent: true });
  });

  it("refuses another course's Instructor moderation", async () => {
    const other = addUser("Olive Other", schema.UserRole.Instructor);
    const response = await thrown(() =>
      access.requireStaff(other.id, "US", course.id)
    );
    expect(response.init?.status).toBe(403);
  });

  it("keeps a Student who isn't enrolled out of content and moderation", async () => {
    const result = await access.getAccess(student.id, "US", course.id);
    expect(result).toMatchObject({
      userId: student.id,
      isStaff: false,
      enrolled: false,
      canViewContent: false,
    });

    const content = await thrown(() =>
      access.requireContentAccess(student.id, "US", course.id)
    );
    expect(content.init?.status).toBe(403);
    expect(content.data).toBe("You must be enrolled in this course.");

    const staff = await thrown(() =>
      access.requireStaff(student.id, "US", course.id)
    );
    expect(staff.init?.status).toBe(403);
    expect(staff.data).toBe("Only this course's instructor can do that.");
  });

  it("lets an enrolled Student view content but not moderate", async () => {
    enroll(student.id);

    await expect(
      access.requireContentAccess(student.id, "US", course.id)
    ).resolves.toMatchObject({ enrolled: true, canViewContent: true });
    const staff = await thrown(() =>
      access.requireStaff(student.id, "US", course.id)
    );
    expect(staff.init?.status).toBe(403);
  });

  it("returns a signed-in viewer's id from the sign-in guard", async () => {
    await expect(access.requireUserId(student.id)).resolves.toBe(student.id);
  });
});

describe("the Instructor-or-admin guard", () => {
  it("refuses a Student with 403", async () => {
    const response = await thrown(() =>
      access.requireInstructorOrAdmin(student.id)
    );
    expect(response.init?.status).toBe(403);
    expect(response.data).toBe("Only instructors can access this page.");
  });

  it("gives an Instructor back their id, user and that they aren't an admin", async () => {
    expect(await access.requireInstructorOrAdmin(instructor.id)).toEqual({
      userId: instructor.id,
      user: instructor,
      isAdmin: false,
    });
  });

  it("gives a Platform Admin back their id, user and that they're an admin", async () => {
    const admin = addUser("Pat Admin", schema.UserRole.Admin);
    expect(await access.requireInstructorOrAdmin(admin.id)).toEqual({
      userId: admin.id,
      user: admin,
      isAdmin: true,
    });
  });
});

describe("Country Lock", () => {
  beforeEach(() => {
    setCourse({});
    enroll(student.id);
  });

  async function lockFor(currentCountry: string | null) {
    const result = await access.getAccess(
      student.id,
      currentCountry,
      course.id
    );
    return {
      pppBlocked: result.pppBlocked,
      pppBlockedCountry: result.pppBlockedCountry,
      pppPurchaseCountry: result.pppPurchaseCountry,
      canViewContent: result.canViewContent,
    };
  }

  const NOT_LOCKED = {
    pppBlocked: false,
    pppBlockedCountry: null,
    pppPurchaseCountry: null,
    canViewContent: true,
  };

  it("does not lock a full-price Purchase used from abroad", async () => {
    addPurchase(student.id, "US");
    expect(await lockFor("IN")).toEqual(NOT_LOCKED);
  });

  it("does not lock a Purchasing-Power Price used in the same country", async () => {
    addPurchase(student.id, "IN");
    expect(await lockFor("IN")).toEqual(NOT_LOCKED);
  });

  it("locks a Purchasing-Power Price used from another country, reporting both countries", async () => {
    addPurchase(student.id, "IN");
    expect(await lockFor("US")).toEqual({
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });

    const response = await thrown(() =>
      access.requireContentAccess(student.id, "US", course.id)
    );
    expect(response.init?.status).toBe(403);
    expect(response.data).toBe("You must be enrolled in this course.");
  });

  it("does not lock a Purchasing-Power Price when the country is unknown (ADR-0012)", async () => {
    addPurchase(student.id, "IN");
    expect(await lockFor(null)).toEqual(NOT_LOCKED);
  });

  it("does not lock on a free course", async () => {
    setCourse({ price: 0 });
    addPurchase(student.id, "IN");
    expect(await lockFor("US")).toEqual(NOT_LOCKED);
  });

  it("does not lock when Purchasing-Power Prices are turned off on the course", async () => {
    setCourse({ pppEnabled: false });
    addPurchase(student.id, "IN");
    expect(await lockFor("US")).toEqual(NOT_LOCKED);
  });

  it("does not lock a Purchase with no recorded country", async () => {
    addPurchase(student.id, null);
    expect(await lockFor("US")).toEqual(NOT_LOCKED);
  });

  it("does not lock a Platform Admin enrolled on a discounted Purchase, from abroad (ADR-0009)", async () => {
    const admin = addUser("Pat Admin", schema.UserRole.Admin);
    enroll(admin.id);
    addPurchase(admin.id, "IN");

    expect(await access.getAccess(admin.id, "US", course.id)).toMatchObject({
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("does not lock the owning Instructor enrolled on a discounted Purchase, from abroad (ADR-0009)", async () => {
    enroll(instructor.id);
    addPurchase(instructor.id, "IN");

    expect(
      await access.getAccess(instructor.id, "US", course.id)
    ).toMatchObject({
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });
});

// ─── Fixtures ───
// Rows go in directly; kept in one place so a schema change touches only this
// block.

function addUser(name: string, role: schema.UserRole) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

function enroll(userId: number) {
  db.insert(schema.enrollments).values({ userId, courseId: course.id }).run();
}

function addPurchase(userId: number, country: string | null) {
  db.insert(schema.purchases)
    .values({ userId, courseId: course.id, amountPaid: 1500, country })
    .run();
}

/** Makes the course paid (Purchasing-Power Prices on by default), with overrides. */
function setCourse(values: { price?: number; pppEnabled?: boolean }) {
  course = db
    .update(schema.courses)
    .set({ price: 4999, pppEnabled: true, ...values })
    .returning()
    .get();
}
