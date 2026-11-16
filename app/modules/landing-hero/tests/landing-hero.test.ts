import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import { heroActions } from "../index";

describe("heroActions", () => {
  it("offers someone not signed in Browse Courses, then Sign Up", () => {
    expect(heroActions(null)).toEqual([
      { label: "Browse Courses", to: "/courses", emphasis: "primary" },
      { label: "Sign Up", to: "/signup", emphasis: "secondary" },
    ]);
  });

  it("offers a Student Continue learning first, then Browse Courses", () => {
    expect(heroActions({ role: UserRole.Student })).toEqual([
      { label: "Continue learning", to: "/dashboard", emphasis: "primary" },
      { label: "Browse Courses", to: "/courses", emphasis: "secondary" },
    ]);
  });

  it.each([UserRole.Instructor, UserRole.Admin])(
    "offers a signed-in %s only Browse Courses",
    (role) => {
      expect(heroActions({ role })).toEqual([
        { label: "Browse Courses", to: "/courses", emphasis: "primary" },
      ]);
    }
  );

  it.each([
    null,
    { role: UserRole.Student },
    { role: UserRole.Instructor },
    { role: UserRole.Admin },
  ])("puts exactly one primary action first for %o", (person) => {
    const actions = heroActions(person);
    expect(actions[0].emphasis).toBe("primary");
    expect(actions.filter((a) => a.emphasis === "primary")).toHaveLength(1);
  });
});
