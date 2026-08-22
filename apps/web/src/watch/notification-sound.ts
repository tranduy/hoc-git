interface ToneOscillator {
  type: OscillatorType;
  readonly frequency: { value: number };
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}

interface ToneGain {
  readonly gain: {
    setValueAtTime(value: number, startTime: number): void;
    exponentialRampToValueAtTime(value: number, endTime: number): void;
  };
  connect(destination: unknown): unknown;
}

interface ToneContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<unknown>;
  close?(): Promise<unknown>;
  createOscillator(): ToneOscillator;
  createGain(): ToneGain;
}

type ToneContextFactory = () => ToneContext;

function browserContext(): ToneContext {
  const AudioContextConstructor = window.AudioContext;
  if (AudioContextConstructor === undefined) throw new Error("Web Audio unavailable");
  return new AudioContextConstructor();
}

export class NotificationSound {
  private unlocked = false;
  private pending = false;
  private disposed = false;
  private context: ToneContext | null = null;
  private resumePromise: Promise<unknown> | null = null;
  private readonly unlock = (): void => {
    if (this.disposed) return;
    this.unlocked = true;
    try {
      this.context ??= this.createContext();
      if (this.context.state === "suspended" && this.resumePromise === null) {
        // Chrome only guarantees autoplay permission while this call is still
        // inside the user's pointer/keyboard event. Reuse this unlocked
        // context when a later realtime alert arrives.
        this.resumePromise = Promise.resolve(this.context.resume()).catch(() => undefined);
      }
      if (this.pending) {
        this.pending = false;
        void this.ring();
      }
    } catch {
      // Audio is optional and must never interrupt catalog monitoring.
    }
  };

  constructor(private readonly createContext: ToneContextFactory = browserContext) {
    window.addEventListener("pointerdown", this.unlock, { passive: true });
    window.addEventListener("keydown", this.unlock);
  }

  async play(): Promise<void> {
    if (this.disposed) return;
    if (!this.unlocked) {
      this.pending = true;
      return;
    }
    await this.ring();
  }

  private async ring(): Promise<void> {
    try {
      this.context ??= this.createContext();
      if (this.context.state === "suspended" && this.resumePromise === null) {
        this.resumePromise = Promise.resolve(this.context.resume()).catch(() => undefined);
      }
      if (this.resumePromise !== null) await this.resumePromise;
      const context = this.context;
      const offsets = [0, 0.18, 1.2, 1.38, 2.4, 2.58, 3.6, 3.78];
      for (const [index, offset] of offsets.entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index % 2 === 0 ? 659.25 : 783.99;
        oscillator.connect(gain);
        gain.connect(context.destination);
        const startsAt = Math.round((context.currentTime + offset) * 1_000) / 1_000;
        gain.gain.setValueAtTime(0.0001, startsAt);
        gain.gain.exponentialRampToValueAtTime(0.12, startsAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.15);
        oscillator.start(startsAt);
        oscillator.stop(startsAt + 0.16);
      }
    } catch {
      // Audio is optional and must never interrupt catalog monitoring.
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending = false;
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    if (this.context?.close !== undefined) void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
