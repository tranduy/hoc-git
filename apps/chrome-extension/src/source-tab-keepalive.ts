export interface SourceTabDebuggerPort {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  sendCommand(tabId: number, method: string, params?: Record<string, unknown>): Promise<void>;
}

const INITIAL_PULSE_TIMEOUT_MS = 2_000;

export class SourceTabKeepAlive {
  readonly #port: SourceTabDebuggerPort;

  constructor(port: SourceTabDebuggerPort) {
    this.#port = port;
  }

  async attach(tabId: number): Promise<void> {
    await this.#port.attach(tabId);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.pulse(tabId).catch(() => undefined),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, INITIAL_PULSE_TIMEOUT_MS); })
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async detach(tabId: number): Promise<void> {
    await this.#port.detach(tabId);
  }

  async pulse(tabId: number): Promise<void> {
    await this.#port.sendCommand(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.#port.sendCommand(tabId, "Page.setWebLifecycleState", { state: "active" });
  }
}
