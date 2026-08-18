# ROI Profit Toast Design

Exact two-book tickets with estimated ROI strictly greater than 5% emit a right-side toast, whether their catalog evidence is fresh or retained stale. Stale alerts must say `STALE DISPLAY ONLY`; they are informational and never executable.

An alert identity is event, exact market row, and the sorted provider/outcome legs. Each identity emits at most once during the mounted dashboard session, even if its ROI changes, drops below threshold, disappears, or returns. Toasts remain visible for 10 seconds, retain only the newest five, open the exact match when clicked, and request one notification sound per emitted alert. Browser audio remains fail-safe and activates only after a user gesture.
