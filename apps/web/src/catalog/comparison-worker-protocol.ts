import type { LiveCatalogResponse } from "../api/catalog.js";
import type { ComparisonEvent } from "./comparison.js";

export type ComparisonProjection = Omit<ComparisonEvent, "catalogs"> & {
  readonly accountIds: readonly string[];
};

export type ComparisonWorkerCommand =
  | { readonly type: "RESET"; readonly generation: number;
      readonly catalogs: readonly LiveCatalogResponse[]; readonly staleAccountIds: readonly string[] }
  | { readonly type: "UPSERT"; readonly generation: number;
      readonly catalog: LiveCatalogResponse; readonly stale: boolean }
  | { readonly type: "SET_STALE"; readonly generation: number;
      readonly accountId: string; readonly stale: boolean }
  | { readonly type: "REMOVE"; readonly generation: number; readonly accountId: string };

export interface ComparisonWorkerOutput {
  readonly generation: number;
  readonly displayEvents: readonly ComparisonProjection[];
  readonly freshEvents: readonly ComparisonProjection[];
}
