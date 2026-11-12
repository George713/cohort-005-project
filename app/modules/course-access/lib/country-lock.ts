import { getTierForCountry } from "~/lib/ppp";

export type CountryLock = Readonly<{
  locked: boolean;
  currentCountry: string | null;
  purchaseCountry: string | null;
}>;

export const NOT_LOCKED: CountryLock = {
  locked: false,
  currentCountry: null,
  purchaseCountry: null,
};

function wasSoldAtPurchasingPowerPrice(
  coursePrice: number,
  coursePppEnabled: boolean,
  purchaseCountry: string | null
): purchaseCountry is string {
  return (
    coursePrice > 0 &&
    coursePppEnabled &&
    !!purchaseCountry &&
    getTierForCountry(purchaseCountry) !== 1
  );
}

/**
 * Whether a Country Lock holds: a Purchase made at a Purchasing-Power Price
 * being used from a different country than it was bought in.
 */
export function checkCountryLock(
  coursePrice: number,
  coursePppEnabled: boolean,
  purchaseCountry: string | null,
  currentCountry: string | null
): CountryLock {
  if (
    !wasSoldAtPurchasingPowerPrice(
      coursePrice,
      coursePppEnabled,
      purchaseCountry
    )
  ) {
    return NOT_LOCKED;
  }

  // An unknown country never locks (ADR-0012): a missing header must not cost
  // a Student the access they paid for.
  if (!currentCountry || currentCountry === purchaseCountry) return NOT_LOCKED;

  return { locked: true, currentCountry, purchaseCountry };
}
