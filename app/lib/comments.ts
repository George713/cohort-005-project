export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

/**
 * The one rule for deleting a comment, shared by the server and the lesson
 * page's delete control. A Discussion Question only by staff; a Discussion
 * Reply by its author or by staff.
 */
export function canDeleteComment(
  comment: { authorId: number; isReply: boolean },
  viewer: { userId: number | null; isStaff: boolean }
): boolean {
  if (viewer.isStaff) return true;
  if (viewer.userId === null) return false;
  return comment.isReply && comment.authorId === viewer.userId;
}

/**
 * The URL fragment a comment is addressed by, shared by the Notification's url
 * and the id the lesson page renders on each comment.
 */
export function commentAnchorId(commentId: number): string {
  return `comment-${commentId}`;
}

/** Where to read a comment: its lesson page, scrolled to the comment. */
export function lessonCommentUrl(
  courseSlug: string,
  lessonId: number,
  commentId: number
): string {
  return `/courses/${courseSlug}/lessons/${lessonId}#${commentAnchorId(commentId)}`;
}

/** Where to read a Discussion Reply: the question's lesson page, scrolled to
 * the Discussion Question with the new Discussion Reply highlighted. */
export function lessonReplyUrl(
  courseSlug: string,
  lessonId: number,
  questionId: number,
  replyId: number
): string {
  return `/courses/${courseSlug}/lessons/${lessonId}?reply=${replyId}#${commentAnchorId(questionId)}`;
}

/** The top of a lesson's discussion thread, used when a comment is gone. */
export const DISCUSSION_THREAD_ANCHOR_ID = "discussion-thread";
