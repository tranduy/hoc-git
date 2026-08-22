export function isSupportedFootballTwoWayLine(line: string | null): boolean {
  if (line === null || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(line)) return false;
  const value = Math.abs(Number(line));
  if (!Number.isFinite(value)) return false;
  const quarterUnits = value * 4;
  return Number.isInteger(quarterUnits) && quarterUnits % 4 !== 0;
}
