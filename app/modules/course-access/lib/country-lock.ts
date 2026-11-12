import { getTierForCountry } from "~/lib/ppp";

/**
 * Whether a Country Lock holds: a Purchase made at a Purchasing-Power Price
 * being used from a different country than it was bought in.
 */
export function checkCountryLock(
  coursePrice: number,
  coursePppEnabled: boolean,
  purchaseCountry: string | null,
  currentCountry: string | null
): {
  blocked: boolean;
  blockedCountry: string | null;
  purchaseCountry: string | null;
} {
  const result = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  // Skip: free courses or courses with Purchasing-Power Prices turned off
  if (coursePrice <= 0 || !coursePppEnabled) return result;

  // Skip: no purchase country recorded
  if (!purchaseCountry) return result;

  // Skip: full-price (Tier 1) purchases — no geographic restriction
  if (getTierForCountry(purchaseCountry) === 1) return result;

  // Discounted purchase — verify country match. Unknown country never locks.
  if (currentCountry && currentCountry !== purchaseCountry) {
    result.blocked = true;
    result.blockedCountry = currentCountry;
    result.purchaseCountry = purchaseCountry;
  }

  return result;
}
