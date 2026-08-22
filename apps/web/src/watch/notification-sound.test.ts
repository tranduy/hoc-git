import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationSound } from "./notification-sound.js";

afterEach(() => vi.restoreAllMocks());

describe("NotificationSound", () => {
  it("stays silent before a user gesture and plays four soft ting-ting pairs instead of sustained tones", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const resume = vi.fn(async () => undefined);
    const create = vi.fn(() => ({ state: "suspended", resume, currentTime: 1,
      createGain: () => ({ gain: { setValueAtTime, exponentialRampToValueAtTime }, connect: vi.fn() }),
      destination: {}, createOscillator: () => ({ type: "sine" as OscillatorType, frequency: { value: 0 },
        connect: vi.fn(), start, stop }) }));
    const sound = new NotificationSound(create);

    expect(create).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pointerdown"));
    expect(create).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    await sound.play();
    expect(start).toHaveBeenCalledTimes(8);
    expect(start).toHaveBeenNthCalledWith(1, 1);
    expect(start).toHaveBeenNthCalledWith(2, 1.18);
    expect(start).toHaveBeenNthCalledWith(7, 4.6);
    expect(start).toHaveBeenNthCalledWith(8, 4.78);
    expect(stop).toHaveBeenNthCalledWith(1, 1.16);
    expect(stop).toHaveBeenNthCalledWith(8, 4.94);
    expect(setValueAtTime).toHaveBeenNthCalledWith(1, 0.0001, 1);
    expect(exponentialRampToValueAtTime).toHaveBeenNthCalledWith(1, 0.12, 1.015);
    expect(exponentialRampToValueAtTime).toHaveBeenNthCalledWith(2, 0.0001, 1.15);
    sound.dispose();
  });

  it("creates and resumes one reusable audio context inside the user gesture", async () => {
    const resume = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const create = vi.fn(() => ({ state: "suspended", resume, close, currentTime: 1,
      createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
      destination: {}, createOscillator: () => ({ type: "sine" as OscillatorType, frequency: { value: 0 },
        connect: vi.fn(), start: vi.fn(), stop: vi.fn() }) }));
    const sound = new NotificationSound(create);

    window.dispatchEvent(new Event("pointerdown"));
    await sound.play();
    await sound.play();

    expect(create).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    sound.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it("plays a queued alert on the first user gesture when Chrome blocked autoplay at page load", async () => {
    const start = vi.fn();
    const resume = vi.fn(async () => undefined);
    const create = vi.fn(() => ({ state: "suspended", resume, currentTime: 2,
      createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
      destination: {}, createOscillator: () => ({ type: "sine" as OscillatorType, frequency: { value: 0 },
        connect: vi.fn(), start, stop: vi.fn() }) }));
    const sound = new NotificationSound(create);

    await sound.play();
    expect(start).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    expect(start).toHaveBeenCalledTimes(8);
    sound.dispose();
  });

  it("swallows unsupported audio and oscillator errors", async () => {
    const sound = new NotificationSound(() => { throw new Error("unsupported"); });
    window.dispatchEvent(new Event("keydown"));
    await expect(sound.play()).resolves.toBeUndefined();
    sound.dispose();
  });
});
