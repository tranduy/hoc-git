import { useEffect, useState } from "react";
import { formatDisplayDecimal } from "../catalog/display-format.js";

type StoredLeg = { readonly provider: string; readonly accountId: string; readonly providerEventId: string;
  readonly providerMarketId: string; readonly providerSelectionId: string; readonly selection: string;
  readonly line: string | null; readonly decimalOdds: string; readonly stake: string; readonly currency: string };
type HistoryRecord = { readonly id: string; readonly stage: "PREFLIGHT_READY"; readonly recordedAtMs: number;
  readonly ticketId: string; readonly opportunityId: string; readonly canonicalEventId: string;
  readonly canonicalMarketId: string; readonly baseCurrency: string; readonly totalStakeBase: string;
  readonly worstCaseProfit: string; readonly issuedAtMs: number; readonly expiresAtMs: number;
  readonly legs: readonly [StoredLeg, StoredLeg] } | { readonly id: string; readonly stage: "DRY_RUN_RESULT";
  readonly recordedAtMs: number; readonly ticketId: string; readonly idempotencyKey: string;
  readonly status: "BOTH_ACCEPTED" | "NONE_ACCEPTED" | "PARTIAL_FAILURE";
  readonly legs: readonly { readonly provider: string; readonly providerSelectionId: string;
    readonly status: string; readonly reason: string | null }[] };
type HistoryResponse = { readonly storageState: "READY" | "UNAVAILABLE"; readonly records: readonly HistoryRecord[] };

export interface BetHistoryApiLike { list(): Promise<HistoryResponse> }

class BetHistoryApi implements BetHistoryApiLike {
  async list(): Promise<HistoryResponse> {
    const response = await window.fetch("/api/bet-history?limit=200", { cache: "no-store" });
    if (!response.ok) throw new Error("BET_HISTORY_UNAVAILABLE");
    return response.json() as Promise<HistoryResponse>;
  }
}

function money(value: string, currency: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("vi-VN").format(number)} ${currency}` : `${value} ${currency}`;
}

export function BetHistoryPage({ api = new BetHistoryApi() }: { readonly api?: BetHistoryApiLike }) {
  const [response, setResponse] = useState<HistoryResponse | null>(null);
  useEffect(() => { void api.list().then(setResponse).catch(() => setResponse({ storageState: "UNAVAILABLE", records: [] })); }, [api]);

  return <section>
    <header className="page-header"><p>LOCAL · OWN DATA</p><h1>Lịch sử vé của tôi</h1>
      <p>Chỉ hiển thị vé do hệ thống này preflight/dry-run. Không đọc lịch sử từ nhà cái.</p></header>
    {response === null ? <p className="empty-state">Đang tải lịch sử…</p>
      : response.storageState === "UNAVAILABLE" ? <p className="session-message">Không đọc được file lịch sử. Theo dõi và cược không bị dừng.</p>
      : response.records.length === 0 ? <p className="empty-state">Chưa có vé nào được preflight hoặc dry-run.</p>
      : <div className="opportunity-list">{response.records.map((record) => <article className="opportunity-card" key={record.id}>
        <header><span className="read-only-badge">{record.stage}</span><h2>{record.ticketId}</h2>
          <p>{new Date(record.recordedAtMs).toLocaleString("vi-VN")}</p></header>
        {record.stage === "PREFLIGHT_READY" ? <>
          <dl className="opportunity-summary"><div><dt>Thị trường</dt><dd>{record.canonicalMarketId}</dd></div>
            <div><dt>Tổng tiền</dt><dd>{money(record.totalStakeBase, record.baseCurrency)}</dd></div>
            <div><dt>Lãi thấp nhất dự kiến</dt><dd className="confidence-high">{money(record.worstCaseProfit, record.baseCurrency)}</dd></div></dl>
          <ul className="opportunity-legs">{record.legs.map((leg) => <li className="opportunity-leg" key={leg.providerSelectionId}>
            <strong>{leg.provider} · {leg.selection} · {formatDisplayDecimal(leg.decimalOdds)}</strong>
            <p>{money(leg.stake, leg.currency)} · kèo {leg.line ?? "—"}</p></li>)}</ul>
        </> : <p>Dry-run: <strong>{record.status}</strong> · {record.legs.map((leg) => `${leg.provider} ${leg.status}`).join(" · ")}</p>}
      </article>)}</div>}
  </section>;
}
