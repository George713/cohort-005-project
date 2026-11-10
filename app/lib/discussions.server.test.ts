import { describe, it, expect, beforeEach } from "vitest";
import {
  addAdmin,
  addStudent,
  createTestDb,
  fakeNotificationTransport,
  seedBaseData,
} from "~/test/setup";
import * as schema from "~/db/schema";
import {
  createComment,
  deleteComment,
  editComment,
  getComment,
} from "./discussions.server";
import { sendNotification } from "./notifications.server";

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

  it("returns a discussion-question-new Notification to the course's Instructor", () => {
    const result = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "How do hooks work?"
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.notification).toMatchObject({
      kind: "discussion-question-new",
      recipients: [base.instructor.id],
      actor: base.user.id,
      subjectId: result.comment.id,
      data: {
        studentName: base.user.name,
        courseTitle: base.course.title,
        lessonTitle: "Lesson 1",
        url: `/courses/test-course/lessons/${lessonId}#comment-${result.comment.id}`,
      },
    });
  });

  it("sends no discussion-question-new Notification for the Instructor's own top-level comment", () => {
    const result = createComment(
      db,
      base.instructor.id,
      lessonId,
      null,
      "Welcome to the course!"
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.notification).toBeNull();
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

  it("sends no discussion-question-new Notification for a Discussion Reply", () => {
    const question = postQuestion();

    const result = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Hooks let you reuse stateful logic."
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.notification?.kind).not.toBe("discussion-question-new");
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

describe("notifying the asking Student of a staff Discussion Reply", () => {
  it("tells the Discussion Question's author when the course's Instructor replies", () => {
    const question = postQuestion();

    const result = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Hooks let you reuse stateful logic."
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.notification).toMatchObject({
      kind: "discussion-reply-from-staff",
      recipients: [base.user.id],
      actor: base.instructor.id,
      subjectId: result.comment.id,
      data: {
        replierName: base.instructor.name,
        courseTitle: base.course.title,
        lessonTitle: "Lesson 1",
        url: `/courses/test-course/lessons/${lessonId}?reply=${result.comment.id}#comment-${question.id}`,
      },
    });
  });

  it("tells the Discussion Question's author when a Platform Admin replies", () => {
    const question = postQuestion();
    const admin = addAdmin(db, "Pat Admin");

    const result = createComment(
      db,
      admin.id,
      lessonId,
      question.id,
      "Answering as Cadence staff."
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.notification).toMatchObject({
      kind: "discussion-reply-from-staff",
      recipients: [base.user.id],
      actor: admin.id,
      subjectId: result.comment.id,
      data: {
        replierName: admin.name,
        courseTitle: base.course.title,
        lessonTitle: "Lesson 1",
        url: `/courses/test-course/lessons/${lessonId}?reply=${result.comment.id}#comment-${question.id}`,
      },
    });
  });

  it("sends nothing when another Student replies", () => {
    const question = postQuestion();
    const ben = addStudent(db, "Ben");

    const result = createComment(
      db,
      ben.id,
      lessonId,
      question.id,
      "A student's answer."
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.notification).toBeNull();
  });

  it("notifies nobody when staff reply to their own question", async () => {
    const ownQuestion = createComment(
      db,
      base.instructor.id,
      lessonId,
      null,
      "A note from me."
    );
    if (!ownQuestion.ok) throw new Error(ownQuestion.error);

    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      ownQuestion.comment.id,
      "Following up on my own note."
    );
    if (!reply.ok) throw new Error(reply.error);
    if (!reply.notification) throw new Error("Expected a Notification value.");

    const { sent, transport } = fakeNotificationTransport();
    await sendNotification(reply.notification, transport);

    expect(sent).toHaveLength(0);
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

  it("returns nothing to archive when a comment is edited", () => {
    const question = postQuestion();

    const result = editComment(db, question.id, base.user.id, "An edit.");

    if (!result.ok) throw new Error(result.error);
    expect(result).not.toHaveProperty("archive");
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
    const deleted = deleteComment(db, question.id, base.instructor.id, true);
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
  it("refuses a Student deleting their own Discussion Question", () => {
    const question = postQuestion();

    expect(deleteComment(db, question.id, base.user.id, false)).toMatchObject({
      ok: false,
      status: 403,
      error:
        "Only this course's Instructor or a Platform Admin can delete a Discussion Question",
    });
    expect(getComment(db, question.id)?.deletedAt).toBeNull();
  });

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

  it("asks for a deleted Discussion Reply's staff-reply Notification to be archived", () => {
    const question = postQuestion();
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "The Instructor's answer."
    );
    if (!reply.ok) throw new Error(reply.error);

    const result = deleteComment(db, reply.comment.id, base.instructor.id, true);

    if (!result.ok) throw new Error(result.error);
    expect(result.archive).toEqual([
      {
        kind: "discussion-reply-from-staff",
        subjectId: reply.comment.id,
      },
    ]);
  });

  it("asks for a deleted Discussion Question and every reply's Notification to be archived", () => {
    const question = postQuestion();
    const ben = addStudent(db, "Ben");
    const staffReply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "The Instructor's answer."
    );
    const studentReply = createComment(
      db,
      ben.id,
      lessonId,
      question.id,
      "A student's answer."
    );
    if (!staffReply.ok) throw new Error(staffReply.error);
    if (!studentReply.ok) throw new Error(studentReply.error);

    const result = deleteComment(db, question.id, base.instructor.id, true);

    if (!result.ok) throw new Error(result.error);
    expect(result.archive).toHaveLength(3);
    expect(result.archive).toEqual(
      expect.arrayContaining([
        { kind: "discussion-question-new", subjectId: question.id },
        {
          kind: "discussion-reply-from-staff",
          subjectId: staffReply.comment.id,
        },
        {
          kind: "discussion-reply-from-staff",
          subjectId: studentReply.comment.id,
        },
      ])
    );
  });

  it("lets the course's Instructor delete a Student's Discussion Reply", () => {
    const question = postQuestion();
    const reply = createComment(
      db,
      base.user.id,
      lessonId,
      question.id,
      "A follow-up."
    );
    if (!reply.ok) throw new Error(reply.error);

    const result = deleteComment(db, reply.comment.id, base.instructor.id, true);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.comment.deletedAt).not.toBeNull();
  });

  it("removes a Discussion Question's Discussion Replies when staff delete it", () => {
    const question = postQuestion();
    const ben = addStudent(db, "Ben");
    const studentReply = createComment(
      db,
      ben.id,
      lessonId,
      question.id,
      "A student's answer."
    );
    const staffReply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "The Instructor's answer."
    );
    if (!studentReply.ok) throw new Error(studentReply.error);
    if (!staffReply.ok) throw new Error(staffReply.error);

    const result = deleteComment(db, question.id, base.instructor.id, true);

    expect(result).toMatchObject({ ok: true });
    expect(getComment(db, studentReply.comment.id)?.deletedAt).not.toBeNull();
    expect(getComment(db, staffReply.comment.id)?.deletedAt).not.toBeNull();
  });

  it("lets a Platform Admin delete a Student's Discussion Question", () => {
    const admin = addAdmin(db, "Pat Admin");
    const question = postQuestion();
    const reply = createComment(
      db,
      base.user.id,
      lessonId,
      question.id,
      "A follow-up."
    );
    if (!reply.ok) throw new Error(reply.error);

    const result = deleteComment(db, question.id, admin.id, true);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.comment.deletedAt).not.toBeNull();
    expect(getComment(db, reply.comment.id)?.deletedAt).not.toBeNull();
  });

  it("refuses a Student deleting someone else's Discussion Question", () => {
    const question = postQuestion();
    const ben = addStudent(db, "Ben");

    expect(deleteComment(db, question.id, ben.id, false)).toMatchObject({
      ok: false,
      status: 403,
      error:
        "Only this course's Instructor or a Platform Admin can delete a Discussion Question",
    });
  });

  it("does nothing when the comment is already deleted", () => {
    const question = postQuestion();
    const first = deleteComment(db, question.id, base.instructor.id, true);
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
