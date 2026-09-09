export type ApsportBootstrapStage = "CONTEXT_EVALUATE" | "CONTEXT_FRAME_TREE" |
  "FRAME_TREE" | "WORLD_CREATE" | "WORLD_EVALUATE" | "FRAME_RECHECK";
type ApsportBootstrapError = "TIMEOUT" | "DETACHED" | "TARGET_GONE" | "CONTEXT_GONE" |
  "FRAME_GONE" | "CDP_REJECTED" | "NO_RESULT" | "NO_FRAMES" | "NO_LOADER" |
  "EVALUATION_EXCEPTION" | "IN_PAGE_EXCEPTION";

export function apsportBootstrapCommandError(error: unknown): ApsportBootstrapError {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out/iu.test(message)) return "TIMEOUT";
  if (/not attached|debugger.*detached/iu.test(message)) return "DETACHED";
  if (/no tab|target.*(?:closed|gone)|session.*(?:closed|not found)/iu.test(message)) return "TARGET_GONE";
  if (/context.*(?:not found|cannot|destroyed)|cannot find context/iu.test(message)) return "CONTEXT_GONE";
  if (/frame.*(?:not found|no frame|given id)|no frame/iu.test(message)) return "FRAME_GONE";
  return "CDP_REJECTED";
}

/** Bounded labels and counts only; CDP errors may contain session URLs and are never retained. */
export class ApsportBootstrapDiagnostic {
  readonly #contexts: number;
  readonly #failures = new Set<string>();
  frames = 0;
  worlds = 0;

  constructor(contexts: number) { this.#contexts = contexts; }

  note(stage: ApsportBootstrapStage, error: ApsportBootstrapError): void {
    if (this.#failures.size < 8) this.#failures.add(`${stage}:${error}`);
  }

  has(stage: ApsportBootstrapStage, error: ApsportBootstrapError): boolean {
    return this.#failures.has(`${stage}:${error}`);
  }

  async command(stage: ApsportBootstrapStage, operation: Promise<unknown>): Promise<unknown> {
    try { return await operation; }
    catch (error) { this.note(stage, apsportBootstrapCommandError(error)); return null; }
  }

  evaluation(stage: ApsportBootstrapStage, response: unknown): void {
    if (response === null) return; // command() already records a rejected command.
    if (typeof response !== "object" || response === null) { this.note(stage, "NO_RESULT"); return; }
    if ("exceptionDetails" in response && response.exceptionDetails !== undefined) {
      this.note(stage, "EVALUATION_EXCEPTION"); return;
    }
    const result = "result" in response ? response.result : undefined;
    const value = typeof result === "object" && result !== null && "value" in result ? result.value : undefined;
    if (value === undefined || value === null) this.note(stage, "NO_RESULT");
    else if (typeof value === "object" && "reason" in value &&
      value.reason === "APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE") this.note(stage, "IN_PAGE_EXCEPTION");
  }

  format(): string {
    return `contexts=${this.#contexts} frames=${this.frames} worlds=${this.worlds} failures[${[...this.#failures].join(",")}]`;
  }
}
