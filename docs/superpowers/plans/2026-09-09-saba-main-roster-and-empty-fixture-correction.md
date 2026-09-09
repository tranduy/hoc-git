# SABA main roster and duplicate fixture correction

The final 0.2.100 observation established two remaining defects: SABA requires every hidden More expansion to finish before any complete main roster can publish, and a zero-market AP fixture can occupy the provider slot ahead of its priced duplicate.

The user has authorized the necessary corrections and managed deployment without another confirmation. No betting actions, account rotation, new IM probes or manual provider reloads are part of this change.

1. Reproduce the AP Puebla/Toluca duplicate on the preserved four-provider snapshot. Exclude empty family candidates from pairing without changing source inventory accounting or relaxing ambiguity between two priced fixtures. Add the exact omitted China competition alias, with youth/tier guards retained.
2. Separate verified Today/Early main roster completion from hidden expansion. Collect and reconcile both rosters, confirm Today restoration, preserve original capture clocks, and publish an explicit main-roster terminal before any More action. Hidden completion retains its existing stronger contract and bounded action lane.
3. Validate the main-roster manifest independently in the API. Require the same epoch/frame/document, complete counted membership, unique captures, trusted clocks, explicit timezone and verified restoration. Use a distinct transport snapshot identity for later hidden enrichment. A More failure must not withdraw an already valid main baseline.
4. Run focused regressions and typechecks, build the affected packages, perform one managed handoff, and observe one finite live window. Record actual coverage, missed-pair recovery and any remaining failure; do not use intermediate inventory counts as final acceptance or promise positive ROI.

Implementation ownership: matcher and tests in `top20_ui`; extension main-roster protocol in `normalize_markets`; API validation/publication in `im_request_audit`; root reviews integration, builds, deploys and records final evidence. Existing unrelated work stays intact.
