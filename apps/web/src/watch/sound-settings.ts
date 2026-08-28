export const SOUND_ENABLED_STORAGE_KEY = "tool-chenh:notification-sound-enabled-v1";
export const SOUND_VOLUME_STORAGE_KEY = "tool-chenh:notification-sound-volume-v1";

export function loadSoundVolume(storage: Storage): number {
  try {
    const stored = storage.getItem(SOUND_VOLUME_STORAGE_KEY);
    if (stored !== null) {
      const volume = Number(stored);
      if (Number.isFinite(volume)) return clampVolume(volume);
    }
    return storage.getItem(SOUND_ENABLED_STORAGE_KEY) === "false" ? 0 : 100;
  } catch {
    return 100;
  }
}

export function saveSoundVolume(storage: Storage, volume: number): void {
  try {
    storage.setItem(SOUND_VOLUME_STORAGE_KEY, String(clampVolume(volume)));
  } catch {
    // Browser storage failures must never interrupt realtime monitoring.
  }
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 100;
  return Math.min(100, Math.max(0, Math.round(volume)));
}
