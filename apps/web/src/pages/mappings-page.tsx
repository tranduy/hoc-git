import { useMemo, useState } from "react";
import type { AppSnapshot, CanonicalEvent, CanonicalMarket, MappingStatus } from "@tool-chenh/contracts";
import type { ConnectionState } from "../api/client.js";
import { MappingEvidenceList } from "../components/mapping-evidence.js";

type MappingRow =
  | { readonly type: "Event"; readonly item: CanonicalEvent; readonly id: string; readonly label: string }
  | { readonly type: "Market"; readonly item: CanonicalMarket; readonly id: string; readonly label: string };

const all = "ALL";

function mappingRows(snapshot: AppSnapshot): readonly MappingRow[] {
  const eventRows: readonly MappingRow[] = snapshot.events.map((item) => ({ type: "Event", item, id: item.canonicalEventId, label: `${item.participantA} vs ${item.participantB}` }));
  const marketRows: readonly MappingRow[] = snapshot.markets.map((item) => ({ type: "Market", item, id: item.canonicalMarketId, label: `${item.marketType} · ${item.scope}${item.line === null ? "" : ` · Line ${item.line}`}` }));
  return [...eventRows, ...marketRows];
}

function MappingRowDetails({ row }: { readonly row: MappingRow }) {
  const { item } = row;
  return (
    <details className="mapping-row">
      <summary><span className="mapping-row-label">{row.label}</span><span className={`mapping mapping--${item.mappingStatus.toLowerCase()}`}>{item.mappingStatus.replace("_", " ")}</span><span className="mapping-kind">{row.type} mapping</span></summary>
      <div className="mapping-meta"><span>Category {item.category}</span><span>Canonical ID {row.id}</span></div>
      <MappingEvidenceList evidence={item.mappingEvidence} />
    </details>
  );
}

export function MappingsPage({ snapshot, connectionState }: { readonly snapshot: AppSnapshot; readonly connectionState: ConnectionState }) {
  const [status, setStatus] = useState<MappingStatus | "ALL">(all);
  const visibleRows = useMemo(() => mappingRows(snapshot).filter((row) => status === all || row.item.mappingStatus === status), [snapshot, status]);
  return (
    <>
      <header className="page-header"><p className="eyebrow">Read-only inspection</p><h1>Mapping Review</h1><p>Evidence is supplied by the server. This page cannot approve, alter, or submit a mapping.</p></header>
      {connectionState === "DISCONNECTED" ? <section className="empty-state connection-warning" role="alert"><h2>Connection disconnected</h2><p>Mapping evidence is last-known and non-actionable until a fresh server snapshot returns. Reconnect to the local feed and wait for a fresh server snapshot.</p></section> : null}
      {snapshot.blockedDiagnostics.filter((diagnostic) => diagnostic.code === "STALE").map((diagnostic) => <p className="stale-warning" role="status" key={`${diagnostic.category}:${diagnostic.canonicalMarketId ?? "category"}:${diagnostic.reason}`}>Stale server evidence: {diagnostic.reason}. Wait for a fresh server snapshot.</p>)}
      <section className="filters" aria-label="Mapping filters"><label>Mapping status<select value={status} onChange={(event) => setStatus(event.target.value as MappingStatus | "ALL")}><option value={all}>All statuses</option><option value="VERIFIED">Verified</option><option value="REVIEW_REQUIRED">Review required</option><option value="REJECTED">Rejected</option></select></label></section>
      {visibleRows.length === 0 ? <section className="empty-state" role="status"><h2>No mappings match this filter.</h2><p>Wait for a fresh server snapshot or choose a different status filter.</p></section> : <section className="mapping-list" aria-label="Mapping evidence">{visibleRows.map((row) => <MappingRowDetails key={`${row.type}:${row.id}`} row={row} />)}</section>}
    </>
  );
}
