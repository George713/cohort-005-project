import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  createComment,
  deleteComment,
  editComment,
} from "./discussions.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const courseModule = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: courseModule.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: courseModule.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

function addStudent(name: string) {
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

function postQuestion(lesson = lessonId, body = "How do hooks work?") {
  const result = createComment(db, base.user.id, lesson, null, body);
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

describe("creating a comment", () => {
  it("posts a Discussion Question on the lesson", () => {
    const comment = postQuestion();

    expect(comment).toMatchObject({
      lessonId,
      userId: base.user.id,
      parentId: null,
      body: "How do hooks work?",
      editedAt: null,
      deletedAt: null,
    });
  });

  it("posts a Discussion Reply to a Discussion Question", () => {
    const question = postQuestion();

    const result = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "  Hooks let you reuse stateful logic.  "
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        parentId: question.id,
        userId: base.instructor.id,
        body: "Hooks let you reuse stateful logic.",
      },
    });
  });

  it("refuses an empty comment", () => {
    expect(
      createComment(db, base.user.id, lessonId, null, "   ")
    ).toMatchObject({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("refuses a comment longer than 5000 characters", () => {
    expect(
      createComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toMatchObject({
      ok: false,
      status: 400,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("refuses a Discussion Reply to a Discussion Reply", () => {
    const question = postQuestion();
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "An answer."
    );
    if (!reply.ok) throw new Error(reply.error);

    expect(
      createComment(db, base.user.id, lessonId, reply.comment.id, "Thanks!")
    ).toMatchObject({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });

  it("refuses a Discussion Reply whose parent is on another lesson", () => {
    const elsewhere = postQuestion(otherLessonId, "A question elsewhere.");

    expect(
      createComment(db, base.user.id, lessonId, elsewhere.id, "A reply.")
    ).toMatchObject({
      ok: false,
      status: 400,
      error: "Parent comment belongs to a different lesson",
    });
  });

  it("refuses a Discussion Reply to a comment that does not exist", () => {
    expect(
      createComment(db, base.user.id, lessonId, 9999, "A reply.")
    ).toMatchObject({
      ok: false,
      status: 404,
      error: "Parent comment not found",
    });
  });

  it("refuses a comment on a lesson that does not exist", () => {
    expect(
      createComment(db, base.user.id, 9999, null, "A question.")
    ).toMatchObject({
      ok: false,
      status: 404,
      error: "Lesson not found",
    });
  });
});

describe("editing a comment", () => {
  it("lets the author fix their Discussion Question", () => {
    const question = postQuestion(lessonId, "How do hooks work?");

    const result = editComment(
      db,
      question.id,
      base.user.id,
      "  How do hooks really work?  "
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { id: question.id, body: "How do hooks really work?" },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.comment.editedAt).not.toBeNull();
  });

  it("refuses an edit by anyone but the author", () => {
    const question = postQuestion();

    expect(
      editComment(db, question.id, base.instructor.id, "An edit.")
    ).toMatchObject({
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    });
  });

  it("refuses an empty edit", () => {
    const question = postQuestion();

    expect(editComment(db, question.id, base.user.id, "   ")).toMatchObject({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("refuses an edit longer than 5000 characters", () => {
    const question = postQuestion();

    expect(
      editComment(db, question.id, base.user.id, "a".repeat(5001))
    ).toMatchObject({
      ok: false,
      status: 400,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("refuses to edit a deleted comment", () => {
    const question = postQuestion();
    const deleted = deleteComment(db, question.id, base.user.id, false);
    if (!deleted.ok) throw new Error(deleted.error);

    expect(
      editComment(db, question.id, base.user.id, "An edit.")
    ).toMatchObject({
      ok: false,
      status: 409,
      error: "Comment has been deleted",
    });
  });

  it("refuses to edit a comment that does not exist", () => {
    expect(editComment(db, 9999, base.user.id, "An edit.")).toMatchObject({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });
});

describe("deleting a comment", () => {
  it("lets the author delete their own Discussion Reply", () => {
    const question = postQuestion();
    const reply = createComment(
      db,
      base.user.id,
      lessonId,
      question.id,
      "A follow-up."
    );
    if (!reply.ok) throw new Error(reply.error);

    const result = deleteComment(db, reply.comment.id, base.user.id, false);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.comment.deletedAt).not.toBeNull();
  });

  it("lets the course's Instructor delete a Student's Discussion Question", () => {
    const question = postQuestion();

    const result = deleteComment(db, question.id, base.instructor.id, true);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.comment.deletedAt).not.toBeNull();
  });

  it("lets a Platform Admin delete a Student's Discussion Question", () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const question = postQuestion();

    const result = deleteComment(db, question.id, admin.id, true);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.comment.deletedAt).not.toBeNull();
  });

  it("refuses a Student deleting someone else's Discussion Question", () => {
    const question = postQuestion();
    const ben = addStudent("Ben");

    expect(deleteComment(db, question.id, ben.id, false)).toMatchObject({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
  });

  it("does nothing when the comment is already deleted", () => {
    const question = postQuestion();
    const first = deleteComment(db, question.id, base.user.id, false);
    if (!first.ok) throw new Error(first.error);

    const second = deleteComment(db, question.id, base.instructor.id, true);

    expect(second).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: first.comment.deletedAt },
    });
  });

  it("refuses to delete a comment that does not exist", () => {
    expect(deleteComment(db, 9999, base.user.id, false)).toMatchObject({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });
});
