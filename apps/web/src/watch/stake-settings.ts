export const WATCH_BASE_STAKE_STORAGE_KEY = "tool-chenh:watch-base-stake-v1";
export const DEFAULT_BASE_STAKE = "100000";

export function isValidBaseStake(value: string): boolean {
  return /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 30_000 && Number(value) % 1_000 === 0;
}

export function loadBaseStake(storage: Storage): string {
  const stored = storage.getItem(WATCH_BASE_STAKE_STORAGE_KEY);
  return stored !== null && isValidBaseStake(stored) ? stored : DEFAULT_BASE_STAKE;
}

export function saveBaseStake(storage: Storage, value: string): boolean {
  if (!isValidBaseStake(value)) return false;
  storage.setItem(WATCH_BASE_STAKE_STORAGE_KEY, value);
  return true;
}
