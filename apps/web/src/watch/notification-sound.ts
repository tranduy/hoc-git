interface ToneOscillator {
  type: OscillatorType;
  readonly frequency: { value: number };
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}

interface ToneContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<unknown>;
  createOscillator(): ToneOscillator;
}

type ToneContextFactory = () => ToneContext;

function browserContext(): ToneContext {
  const AudioContextConstructor = window.AudioContext;
  if (AudioContextConstructor === undefined) throw new Error("Web Audio unavailable");
  return new AudioContextConstructor();
}

export class NotificationSound {
  private unlocked = false;
  private disposed = false;
  private readonly unlock = (): void => { this.unlocked = true; };

  constructor(private readonly createContext: ToneContextFactory = browserContext) {
    window.addEventListener("pointerdown", this.unlock, { passive: true });
    window.addEventListener("keydown", this.unlock);
  }

  async play(): Promise<void> {
    if (!this.unlocked || this.disposed) return;
    try {
      const context = this.createContext();
      if (context.state === "suspended") await context.resume();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      oscillator.connect(context.destination);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.12);
    } catch {
      // Audio is optional and must never interrupt catalog monitoring.
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }
}
