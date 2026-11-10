import { describe, expect, it } from "vitest";
import { canDeleteComment } from "./comments";

// The one rule for deleting a comment, shared by the server and the lesson
// page's delete control: a Discussion Question only by staff, a Discussion
// Reply by its author or by staff.

const student = { userId: 1, isStaff: false };
const otherStudent = { userId: 2, isStaff: false };
const instructor = { userId: 3, isStaff: true };

const question = { authorId: 1, isReply: false };
const reply = { authorId: 1, isReply: true };

describe("canDeleteComment", () => {
  it("lets staff delete any Discussion Question and Discussion Reply", () => {
    expect(canDeleteComment(question, instructor)).toBe(true);
    expect(canDeleteComment(reply, instructor)).toBe(true);
  });

  it("refuses a Student deleting their own Discussion Question", () => {
    expect(canDeleteComment(question, student)).toBe(false);
  });

  it("lets a Student delete their own Discussion Reply", () => {
    expect(canDeleteComment(reply, student)).toBe(true);
  });

  it("refuses a Student deleting someone else's Discussion Reply", () => {
    expect(canDeleteComment(reply, otherStudent)).toBe(false);
  });

  it("refuses a signed-out visitor", () => {
    expect(
      canDeleteComment(reply, { userId: null, isStaff: false })
    ).toBe(false);
  });
});
