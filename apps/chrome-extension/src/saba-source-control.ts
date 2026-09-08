export type SabaSourceControlCommand = "RELOAD" | "RESTORE" | "ENSURE";
export type SabaSourceControlAction = "REFRESH_CURRENT" | "RESTORE_DOCUMENT";

/**
 * Preserve a SABA document while this worker has either usable catalog
 * authority or a recent structurally valid football DOM receipt. The latter
 * is liveness only: it prevents destructive recovery during a bounded small-
 * roster/collector window without promoting that receipt to market authority.
 */
export function sabaSourceControlAction(_command: SabaSourceControlCommand,
  hasResponsiveDocument: boolean): SabaSourceControlAction {
  if (hasResponsiveDocument) return "REFRESH_CURRENT";
  return "RESTORE_DOCUMENT";
}
