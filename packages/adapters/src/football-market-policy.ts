export function isSupportedFootballTwoWayLine(line: string | null): boolean {
  if (line === null || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(line)) return false;
  const value = Math.abs(Number(line));
  if (!Number.isFinite(value)) return false;
  const quarterUnits = value * 4;
  return Number.isInteger(quarterUnits);
}

/** Only adjacent half-unit legs have the standard quarter-line settlement. */
export function isSupportedFootballSplitLine(first: number, second: number): boolean {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false;
  return first === second || (Number.isInteger(first * 2) && Number.isInteger(second * 2) &&
    Math.abs(first - second) === 0.5);
}
