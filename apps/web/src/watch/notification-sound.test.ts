import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationSound } from "./notification-sound.js";

afterEach(() => vi.restoreAllMocks());

describe("NotificationSound", () => {
  it("stays silent before a user gesture and plays one short tone after unlock", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const resume = vi.fn(async () => undefined);
    const create = vi.fn(() => ({ state: "suspended", resume, currentTime: 1,
      destination: {}, createOscillator: () => ({ type: "sine" as OscillatorType, frequency: { value: 0 },
        connect: vi.fn(), start, stop }) }));
    const sound = new NotificationSound(create);

    await sound.play();
    expect(create).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pointerdown"));
    await sound.play();
    expect(resume).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith(1.12);
    sound.dispose();
  });

  it("swallows unsupported audio and oscillator errors", async () => {
    const sound = new NotificationSound(() => { throw new Error("unsupported"); });
    window.dispatchEvent(new Event("keydown"));
    await expect(sound.play()).resolves.toBeUndefined();
    sound.dispose();
  });
});
