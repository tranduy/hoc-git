import { type AccountStatus, type ProviderId } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ActiveSecretHandle } from "../sessions/types.js";

const ObservationSchema = z.strictObject({
  hostname: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/u),
  method: z.enum(["GET", "POST"]),
  pathTemplate: z.string().min(1).max(512).regex(/^\/[^?#]*$/u),
  status: z.number().int().min(100).max(599),
  contentType: z.string().min(1).max(128).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u),
  shape: z.string().min(1).max(8_192).regex(/^[^\r\n\u0000-\u001f]+$/u),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/u)
});

const InspectionSchema = z.strictObject({
  controlLabel: z.enum(["Lịch sử cược", "Bet history"]),
  observations: z.array(ObservationSchema).max(100)
});

export const ReceiptProtocolResultSchema = InspectionSchema.extend({
  provider: z.enum(["FABET", "CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]),
  accountId: z.string().min(1).max(128)
}).strict();

export type ReceiptProtocolInspection = z.infer<typeof InspectionSchema>;
export type ReceiptProtocolResult = z.infer<typeof ReceiptProtocolResultSchema>;

export interface ReceiptProtocolReader {
  readonly provider: ProviderId;
  inspect(handle: ActiveSecretHandle): Promise<unknown>;
}

interface AccountAccess {
  listStatuses(): Promise<readonly AccountStatus[]>;
  withActiveHandle<T>(id: string, expectedProvider: ProviderId,
    consume: (handle: ActiveSecretHandle) => Promise<T>): Promise<T>;
}

export class ReceiptProtocolRegistry {
  readonly #accounts: AccountAccess;
  readonly #readers: ReadonlyMap<ProviderId, ReceiptProtocolReader>;

  constructor(options: { readonly accounts: AccountAccess; readonly readers: readonly ReceiptProtocolReader[] }) {
    this.#accounts = options.accounts;
    this.#readers = new Map(options.readers.map((reader) => [reader.provider, reader]));
  }

  async inspect(input: { readonly accountId: string }): Promise<ReceiptProtocolResult> {
    const accountId = z.string().trim().min(1).max(128).parse(input.accountId);
    const account = (await this.#accounts.listStatuses()).find((candidate) => candidate.id === accountId);
    if (account === undefined) throw new Error("RECEIPT_PROTOCOL_ACCOUNT_NOT_FOUND");
    if (account.sessionState !== "ACTIVE") throw new Error("RECEIPT_PROTOCOL_ACCOUNT_UNAVAILABLE");
    const reader = this.#readers.get(account.provider);
    if (reader === undefined) throw new Error("RECEIPT_PROTOCOL_PROVIDER_UNSUPPORTED");
    const raw = await this.#accounts.withActiveHandle(accountId, account.provider,
      async (handle) => reader.inspect(handle));
    const inspected = InspectionSchema.parse(raw);
    return ReceiptProtocolResultSchema.parse({ provider: account.provider, accountId, ...inspected });
  }
}
