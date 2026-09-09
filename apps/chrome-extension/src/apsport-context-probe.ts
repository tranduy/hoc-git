import { apsportBootstrapCommandError } from "./apsport-bootstrap-diagnostic.js";

interface ApsportContextProbeOptions {
  readonly sendCommand: (tabId: number, method: string) => Promise<unknown>;
  readonly readTabHealth?: ((tabId: number) => Promise<unknown>) | undefined;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}
interface ProbeState {
  readonly atMs: number;
  readonly work: Promise<string>;
}
type ProbeResult = { readonly value: unknown } | { readonly error: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function booleanFlag(value: unknown): string { return typeof value === "boolean" ? String(value) : "unknown"; }

/** Two read-only CDP commands, at most once per minute per AP tab. */
export class ApsportContextProbe {
  readonly #options: ApsportContextProbeOptions;
  readonly #now: () => number;
  readonly #states = new Map<number, ProbeState>();

  constructor(options: ApsportContextProbeOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  async read(tabId: number): Promise<string> {
    const nowMs = this.#now();
    let state = this.#states.get(tabId);
    if (state === undefined || nowMs - state.atMs >= 60_000) {
      state = { atMs: nowMs, work: this.#read(tabId) };
      if (this.#states.size >= 8 && !this.#states.has(tabId)) {
        this.#states.delete(this.#states.keys().next().value!);
      }
      this.#states.set(tabId, state);
    }
    return `${await state.work} ageMs=${Math.max(0, this.#now() - state.atMs)}`;
  }

  async #bounded(work: () => Promise<unknown>): Promise<ProbeResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return { value: await Promise.race([work(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error("frame-command-timeout")), this.#options.timeoutMs ?? 2_500);
      })]) };
    } catch (error) { return { error: apsportBootstrapCommandError(error) }; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async #read(tabId: number): Promise<string> {
    const [target, isolate, tab] = await Promise.all([
      this.#bounded(() => this.#options.sendCommand(tabId, "Target.getTargetInfo")),
      this.#bounded(() => this.#options.sendCommand(tabId, "Runtime.getIsolateId")),
      this.#options.readTabHealth === undefined ? Promise.resolve<ProbeResult>({ error: "UNAVAILABLE" })
        : this.#bounded(() => this.#options.readTabHealth!(tabId))
    ]);
    const info = "value" in target ? record(record(target.value).targetInfo) : {};
    const targetType = "error" in target ? target.error :
      typeof info.type === "string" && ["page", "iframe", "worker", "shared_worker", "service_worker"].includes(info.type)
        ? info.type : "NO_RESULT";
    const isolateState = "error" in isolate ? isolate.error :
      typeof record(isolate.value).id === "string" ? "OK" : "NO_RESULT";
    const flags = "value" in tab ? record(tab.value) : {};
    const status = "error" in tab ? tab.error : typeof flags.status === "string" &&
      ["complete", "loading", "unloaded"].includes(flags.status) ? flags.status : "unknown";
    return `probe[target=${targetType} attached=${booleanFlag(info.attached)} isolate=${isolateState} ` +
      `tab=${status} discarded=${booleanFlag(flags.discarded)} frozen=${booleanFlag(flags.frozen)} ` +
      `navigating=${booleanFlag(flags.pendingNavigation)}]`;
  }
}
