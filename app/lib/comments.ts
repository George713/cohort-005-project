export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

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

/** The top of a lesson's discussion thread, used when a comment is gone. */
export const DISCUSSION_THREAD_ANCHOR_ID = "discussion-thread";
