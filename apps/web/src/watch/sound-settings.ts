export const SOUND_ENABLED_STORAGE_KEY = "tool-chenh:notification-sound-enabled-v1";

export function loadSoundEnabled(storage: Storage): boolean {
  try {
    return storage.getItem(SOUND_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveSoundEnabled(storage: Storage, enabled: boolean): void {
  try {
    storage.setItem(SOUND_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Browser storage failures must never interrupt realtime monitoring.
  }
}
