import type { MappingEvidence } from "@tool-chenh/contracts";

export function MappingEvidenceList({ evidence }: { readonly evidence: readonly MappingEvidence[] }) {
  if (evidence.length === 0) return <p className="mapping-empty">The server supplied no evidence gates for this mapping.</p>;
  return (
    <table className="mapping-evidence-table">
      <thead><tr><th>Gate</th><th>Expected</th><th>Actual</th><th>Result</th><th>Reason</th></tr></thead>
      <tbody>{evidence.map((item) => (
        <tr key={item.gate}>
          <td>{item.gate}</td><td>{item.expected}</td><td>{item.actual}</td>
          <td><span className={item.passed ? "mapping mapping--verified" : "mapping mapping--rejected"}>{item.passed ? "PASS" : "FAIL"}</span></td><td>{item.reason}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
