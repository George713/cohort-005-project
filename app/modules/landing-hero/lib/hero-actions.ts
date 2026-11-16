import { UserRole } from "~/db/schema";

export type HeroPerson = { role: UserRole } | null;

export type HeroAction = {
  label: string;
  to: string;
  emphasis: "primary" | "secondary";
};

const browseCourses = (emphasis: HeroAction["emphasis"]): HeroAction => ({
  label: "Browse Courses",
  to: "/courses",
  emphasis,
});

const signUp: HeroAction = {
  label: "Sign Up",
  to: "/signup",
  emphasis: "secondary",
};

const continueLearning: HeroAction = {
  label: "Continue learning",
  to: "/dashboard",
  emphasis: "primary",
};

export function heroActionsFor(person: HeroPerson): HeroAction[] {
  if (person === null) return [browseCourses("primary"), signUp];
  if (person.role === UserRole.Student) {
    return [continueLearning, browseCourses("secondary")];
  }
  return [browseCourses("primary")];
}
