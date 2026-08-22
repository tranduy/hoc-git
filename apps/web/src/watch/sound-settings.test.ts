import { beforeEach, describe, expect, it } from "vitest";
import { loadSoundEnabled, saveSoundEnabled, SOUND_ENABLED_STORAGE_KEY } from "./sound-settings.js";

beforeEach(() => window.localStorage.clear());

describe("notification sound settings", () => {
  it("defaults to enabled and persists the user's choice across page loads", () => {
    expect(loadSoundEnabled(window.localStorage)).toBe(true);
    saveSoundEnabled(window.localStorage, false);
    expect(window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY)).toBe("false");
    expect(loadSoundEnabled(window.localStorage)).toBe(false);
    saveSoundEnabled(window.localStorage, true);
    expect(loadSoundEnabled(window.localStorage)).toBe(true);
  });
});
