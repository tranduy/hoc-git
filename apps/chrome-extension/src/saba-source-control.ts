export type SabaSourceControlCommand = "RELOAD" | "RESTORE" | "ENSURE";
export type SabaSourceControlAction = "REFRESH_CURRENT" | "RESTORE_DOCUMENT" | "RELOAD_DOCUMENT";

/**
 * Preserve a SABA document while this worker has either usable catalog
 * authority or a recent structurally valid football DOM receipt. The latter
 * is liveness only: it prevents destructive recovery during a bounded small-
 * roster/collector window without promoting that receipt to market authority.
 *
 * A responsive document is not a working book. SABA's socket reconnects
 * without ever resending reset, and every frame after that is refused for want
 * of a baseline - 333 of them in ten minutes on 2026-09-12 - while the DOM kept
 * answering and the catalog sat at 56 fixtures against the 117 to 141 the page
 * was listing. Refreshing inside that document cannot rebuild a socket, so
 * while the transport is starved the page itself has to be reloaded. Only the
 * backend can see that, and it says so only at its hard stage, behind a
 * five-minute reload interval.
 */
export function sabaSourceControlAction(_command: SabaSourceControlCommand,
  hasResponsiveDocument: boolean, transportStarved = false): SabaSourceControlAction {
  if (transportStarved) return "RELOAD_DOCUMENT";
  if (hasResponsiveDocument) return "REFRESH_CURRENT";
  return "RESTORE_DOCUMENT";
}
