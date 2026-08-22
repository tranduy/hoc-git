import type { MappingEvidence } from "@tool-chenh/contracts";

export function MappingEvidenceList({
  evidence,
  label
}: {
  readonly evidence: readonly MappingEvidence[];
  readonly label: string;
}) {
  if (evidence.length === 0) return <p className="mapping-empty">The server supplied no evidence gates for this mapping.</p>;
  return <div className="table-wrap" role="region" aria-label={label} tabIndex={0}><table className="mapping-evidence-table">
    <caption>Mapping evidence gates</caption>
    <thead><tr><th scope="col">Gate</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
    <tbody>{evidence.map((item) => (
      <tr key={item.gate}>
        <td>{item.gate}</td><td>{item.expected}</td><td>{item.actual}</td>
        <td><span className={item.passed ? "mapping mapping--verified" : "mapping mapping--rejected"}>{item.passed ? "PASS" : "FAIL"}</span></td><td>{item.reason}</td>
      </tr>
    ))}</tbody>
  </table></div>;
}
