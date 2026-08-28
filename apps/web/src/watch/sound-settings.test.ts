import { beforeEach, describe, expect, it } from "vitest";
import { loadSoundVolume, saveSoundVolume, SOUND_ENABLED_STORAGE_KEY,
  SOUND_VOLUME_STORAGE_KEY } from "./sound-settings.js";

beforeEach(() => window.localStorage.clear());

describe("notification sound settings", () => {
  it("defaults to full volume and persists a bounded percentage across page loads", () => {
    expect(loadSoundVolume(window.localStorage)).toBe(100);
    saveSoundVolume(window.localStorage, 35);
    expect(window.localStorage.getItem(SOUND_VOLUME_STORAGE_KEY)).toBe("35");
    expect(loadSoundVolume(window.localStorage)).toBe(35);
    saveSoundVolume(window.localStorage, 150);
    expect(loadSoundVolume(window.localStorage)).toBe(100);
  });

  it("migrates the old disabled preference to zero volume", () => {
    window.localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, "false");
    expect(loadSoundVolume(window.localStorage)).toBe(0);
  });
});
