import {
  CmdObservedCatalogReader,
  type CmdObservedCatalogReaderOptions
} from "../cmd/cmd-observed-catalog.js";

export type SabaObservedCatalogReaderOptions = Omit<CmdObservedCatalogReaderOptions, "provider">;

export class SabaObservedCatalogReader extends CmdObservedCatalogReader {
  constructor(options: SabaObservedCatalogReaderOptions) {
    super({ ...options, provider: "SABA" });
  }
}
