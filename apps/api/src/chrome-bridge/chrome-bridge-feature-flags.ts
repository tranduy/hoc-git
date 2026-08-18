/** Browser-focus controls are opt-in: they can interrupt a user's bookmaker tab. */
export function isOpenProviderTicketEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
