export type SabaSourceControlCommand = "RELOAD" | "RESTORE" | "ENSURE";
export type SabaSourceControlAction = "REFRESH_CURRENT" | "RESTORE_DOCUMENT" | "ENSURE_LAUNCH";

/**
 * Preserve a SABA document only while this worker has proved its complete
 * baseline. Once that proof is absent, repeated in-page refresh commands
 * cannot repair an expired/no-content document and must be allowed to reach
 * the existing bounded same-tab recovery path.
 */
export function sabaSourceControlAction(command: SabaSourceControlCommand,
  hasCompleteBaseline: boolean): SabaSourceControlAction {
  if (hasCompleteBaseline) return "REFRESH_CURRENT";
  return command === "ENSURE" ? "ENSURE_LAUNCH" : "RESTORE_DOCUMENT";
}
