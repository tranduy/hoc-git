import type {
  Category,
  ProviderConnectionStatus,
  ProviderEvent,
  ProviderMarket,
  ProviderQuote
} from "@tool-chenh/contracts";

export type AdapterRecordKind = "EVENT" | "MARKET" | "QUOTE" | "STATUS" | "UNKNOWN";

export interface AdapterSchemaIssue {
  readonly code: string;
  readonly path: readonly string[];
}

export interface AdapterSchemaError {
  readonly code: "SCHEMA_ERROR";
  readonly adapterId: string;
  readonly provider: string;
  readonly category: Category;
  readonly recordKind: AdapterRecordKind;
  readonly offsetMs: number;
  readonly issues: readonly AdapterSchemaIssue[];
}

export interface ProviderQuoteUpdate {
  readonly source: {
    readonly provider: string;
    readonly category: Category;
  };
  readonly kind: "FULL_SNAPSHOT" | "DELTA";
  readonly transport: "WEBSOCKET" | "POLLING";
  readonly sequence: number | null;
  readonly clock: {
    readonly monotonicNowMs: number;
    readonly wallClockNowMs: number;
  };
  readonly quotes: readonly ProviderQuote[];
}

export interface ProviderSink {
  beginBatch?(): void;
  onEvent(event: ProviderEvent): void;
  onMarket(market: ProviderMarket): void;
  onQuoteUpdate(update: ProviderQuoteUpdate): void;
  onStatus(status: ProviderConnectionStatus): void;
  onSchemaError(error: AdapterSchemaError): void;
  endBatch?(): void;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly categories: readonly Category[];
  start(sink: ProviderSink, signal: AbortSignal): Promise<void>;
}
