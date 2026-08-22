import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ReceiptProtocolReader } from "../../receipts/receipt-protocol-registry.js";
import type { ReceiptProtocolInspection } from "./sbobet-receipt-protocol.js";

export interface SbobetReceiptProtocolSource {
  inspectReceiptProtocol(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<ReceiptProtocolInspection>;
}

export class SbobetReceiptProtocolReader implements ReceiptProtocolReader {
  readonly provider = "SBOBET" as const;
  readonly #source: SbobetReceiptProtocolSource;

  constructor(options: { readonly source: SbobetReceiptProtocolSource }) {
    this.#source = options.source;
  }

  async inspect(handle: ActiveSecretHandle): Promise<ReceiptProtocolInspection> {
    if (handle.provider !== "SBOBET") throw new Error("SBOBET_RECEIPT_PROTOCOL_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("SBOBET_RECEIPT_PROTOCOL_UNAVAILABLE");
      return this.#source.inspectReceiptProtocol({ sessionId: handle.sessionId, launchUrl: secret.value });
    });
  }
}
