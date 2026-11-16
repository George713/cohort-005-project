import { heroActionsFor, type HeroPerson } from "./lib/hero-actions";

export type { HeroAction, HeroPerson } from "./lib/hero-actions";

/**
 * The buttons under the landing page hero, in display order, for whoever is
 * looking: someone not signed in (`null`), a Student, or any other Person.
 * Exactly one action is primary, and it comes first.
 */
export function heroActions(person: HeroPerson) {
  return heroActionsFor(person);
}
