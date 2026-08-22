export interface SourceTabDebuggerPort {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  sendCommand(tabId: number, method: string, params?: Record<string, unknown>): Promise<void>;
}

export class SourceTabKeepAlive {
  readonly #port: SourceTabDebuggerPort;

  constructor(port: SourceTabDebuggerPort) {
    this.#port = port;
  }

  async attach(tabId: number): Promise<void> {
    await this.#port.attach(tabId);
    await this.pulse(tabId);
  }

  async detach(tabId: number): Promise<void> {
    await this.#port.detach(tabId);
  }

  async pulse(tabId: number): Promise<void> {
    await this.#port.sendCommand(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.#port.sendCommand(tabId, "Page.setWebLifecycleState", { state: "active" });
  }
}
