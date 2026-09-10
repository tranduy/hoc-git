import type { NativeMarketObservation } from "@tool-chenh/contracts";

/** Release fields already represented by canonical markets and quotes. */
export function compactBtiNativeObservation(observation: NativeMarketObservation): NativeMarketObservation {
  if (observation.disposition !== "NORMALIZED") return observation;
  const { nativeSelections: _nativeSelections, nativeRow: _nativeRow,
    outcomeLabels: _outcomeLabels, ...identity } = observation;
  return { ...identity, nativeLabel: null, outcomeLabels: [] };
}
