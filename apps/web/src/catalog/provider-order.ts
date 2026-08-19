import type { ProviderId } from "@tool-chenh/contracts";

/** One canonical order for data anchoring and every provider-facing UI. */
export const PROVIDER_DISPLAY_ORDER: readonly ProviderId[] = [
  "SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI", "FABET"
];

const providerRank = new Map(PROVIDER_DISPLAY_ORDER.map((provider, index) => [provider, index]));

export function compareProviders(left: ProviderId, right: ProviderId): number {
  return (providerRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (providerRank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right);
}

export function sortProviders(providers: readonly ProviderId[]): ProviderId[] {
  return [...providers].sort(compareProviders);
}

export function sortProviderItems<T>(items: readonly T[], providerOf: (item: T) => ProviderId,
  tieBreak?: (left: T, right: T) => number): T[] {
  return [...items].sort((left, right) => compareProviders(providerOf(left), providerOf(right)) ||
    (tieBreak?.(left, right) ?? 0));
}
