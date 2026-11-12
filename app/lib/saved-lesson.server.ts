import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteSelect } from "drizzle-orm/sqlite-core";
import { courses, lessons, modules } from "~/db/schema";

// ─── Saved Lesson ───
// What a row on the Saved page needs to link back to its Lesson and name its
// Course. Bookmarks and Notes both select these columns and add the joins
// below to reach them.

export const savedLessonColumns = {
  id: lessons.id,
  title: lessons.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** Joins a row's Lesson, through its Module, to its Course. */
export function joinSavedLesson<T extends SQLiteSelect>(
  query: T,
  lessonId: SQLiteColumn
) {
  return query
    .innerJoin(lessons, eq(lessons.id, lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId));
}
