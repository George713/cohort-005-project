import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import {
  lessonCommentUrl,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from "~/lib/comments";
import type { ArchiveRequest, Notification } from "~/lib/notifications.server";

// ─── Discussions ───
// Everything about writing in a lesson's discussion: posting, editing and
// deleting a Discussion Question or Discussion Reply. The lesson page and the
// Unanswered Questions queue both go through here. See GLOSSARY.md for the
// language.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

export type Comment = typeof comments.$inferSelect;

export type Failure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
};
export type CommentResult = { ok: true; comment: Comment } | Failure;

export type CreateCommentResult =
  | {
      ok: true;
      comment: Comment;
      /** The Notification the comment produced, if any. */
      notification: Notification | null;
    }
  | Failure;

export type DeleteCommentResult =
  | {
      ok: true;
      comment: Comment;
      /** The Notifications this deletion retired, for the route to archive. */
      archive: ArchiveRequest[];
    }
  | Failure;

type ValidBody = { ok: true; body: string } | Failure;

function validBody(body: string): ValidBody {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, status: 400, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, body: trimmed };
}

export function getComment(db: Queryable, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

export function createComment(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): CreateCommentResult {
  const validated = validBody(body);
  if (!validated.ok) return validated;

  const lesson = db
    .select({
      title: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    return { ok: false, status: 404, error: "Lesson not found" };
  }

  const parent = parentId === null ? null : getComment(db, parentId);
  if (parentId !== null) {
    if (!parent) {
      return { ok: false, status: 404, error: "Parent comment not found" };
    }
    if (parent.lessonId !== lessonId) {
      return {
        ok: false,
        status: 400,
        error: "Parent comment belongs to a different lesson",
      };
    }
    if (parent.parentId !== null) {
      return {
        ok: false,
        status: 400,
        error: "Replies can only be one level deep",
      };
    }
  }

  const comment = db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: validated.body })
    .returning()
    .get();

  // A top-level comment by anyone but the course's Instructor is a Discussion
  // Question, and the Instructor hears about it. A Discussion Reply from the
  // course's Instructor or a Platform Admin answers the question its author
  // asked, so that author hears about it. The Notifications module drops the
  // actor, so staff replying to their own question notify nobody.
  let notification: Notification | null = null;
  if (parentId === null) {
    if (userId !== lesson.instructorId) {
      const author = db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      notification = {
        kind: "discussion-question-new",
        recipients: [lesson.instructorId],
        actor: userId,
        subjectId: comment.id,
        data: {
          studentName: author?.name ?? "Someone",
          courseTitle: lesson.courseTitle,
          lessonTitle: lesson.title,
          url: lessonCommentUrl(lesson.courseSlug, lessonId, comment.id),
        },
      };
    }
  } else if (parent) {
    const author = db
      .select({ name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    const isStaff =
      userId === lesson.instructorId || author?.role === UserRole.Admin;

    if (isStaff) {
      notification = {
        kind: "discussion-reply-from-staff",
        recipients: [parent.userId],
        actor: userId,
        subjectId: comment.id,
        data: {
          staffName: author?.name ?? "Someone",
          courseTitle: lesson.courseTitle,
          lessonTitle: lesson.title,
          url: lessonCommentUrl(lesson.courseSlug, lessonId, comment.id),
        },
      };
    }
  }

  return { ok: true, comment, notification };
}

export function editComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string
): CommentResult {
  const validated = validBody(body);
  if (!validated.ok) return validated;

  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }
  if (existing.deletedAt !== null) {
    return { ok: false, status: 409, error: "Comment has been deleted" };
  }
  if (existing.userId !== userId) {
    return {
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    };
  }

  const comment = db
    .update(comments)
    .set({ body: validated.body, editedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}

export function deleteComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean
): DeleteCommentResult {
  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }

  // A Discussion Question's author may edit it but not delete it: only the
  // course's Instructor or a Platform Admin can remove a question. A
  // Discussion Reply still belongs to its author (or staff).
  if (existing.parentId === null) {
    if (!isStaff) {
      return {
        ok: false,
        status: 403,
        error:
          "Only this course's Instructor or a Platform Admin can delete a Discussion Question",
      };
    }
  } else if (existing.userId !== userId && !isStaff) {
    return {
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    };
  }

  if (existing.deletedAt !== null) {
    return { ok: true, comment: existing, archive: [] };
  }

  return db.transaction((tx): DeleteCommentResult => {
    const deletedAt = new Date().toISOString();
    let archive: ArchiveRequest[];

    // A Discussion Question takes its Discussion Replies with it. They are
    // soft-deleted like any other comment, and the thread stops showing the
    // question, so no placeholder is left behind. Deleting any of them retires
    // the Notifications that pointed at it.
    if (existing.parentId === null) {
      const replies = tx
        .select({ id: comments.id })
        .from(comments)
        .where(and(eq(comments.parentId, commentId), isNull(comments.deletedAt)))
        .all();

      tx.update(comments)
        .set({ deletedAt })
        .where(and(eq(comments.parentId, commentId), isNull(comments.deletedAt)))
        .run();

      archive = [
        archiveDiscussionQuestionNotification(commentId),
        ...replies.map((reply) =>
          archiveDiscussionReplyNotification(reply.id)
        ),
      ];
    } else {
      archive = [archiveDiscussionReplyNotification(commentId)];
    }

    const comment = tx
      .update(comments)
      .set({ deletedAt })
      .where(eq(comments.id, commentId))
      .returning()
      .get();

    return { ok: true, comment, archive };
  });
}

function archiveDiscussionQuestionNotification(
  commentId: number
): ArchiveRequest {
  return { workflow: "discussion-question-new", subjectId: commentId };
}

function archiveDiscussionReplyNotification(commentId: number): ArchiveRequest {
  return { workflow: "discussion-reply-from-staff", subjectId: commentId };
}
