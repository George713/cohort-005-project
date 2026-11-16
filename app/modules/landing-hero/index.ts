import { heroActionsFor, type HeroViewer } from "./lib/hero-actions";

export type { HeroAction, HeroViewer } from "./lib/hero-actions";

/**
 * The buttons under the landing page hero, in display order, for whoever is
 * looking: a signed-out visitor, a Student, or anyone else signed in.
 * Exactly one action is primary, and it comes first.
 */
export function heroActions(viewer: HeroViewer) {
  return heroActionsFor(viewer);
}
