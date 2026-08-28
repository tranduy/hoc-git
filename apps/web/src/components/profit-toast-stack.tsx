import { useEffect, useRef } from "react";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";

interface SoundLike { play(volume?: number): Promise<void> | void }

// Kept as a headless notifier so the existing alert fingerprinting remains the
// single source of truth while the dashboard itself is the only visual output.
export function ProfitToastStack({ alerts, sound, enabled = true, volume = 1 }: {
  readonly alerts: readonly ProfitAlert[];
  readonly sound: SoundLike;
  readonly enabled?: boolean;
  readonly volume?: number;
}) {
  const seen = useRef(new Set<string>());

  useEffect(() => {
    for (const alert of alerts) {
      if (seen.current.has(alert.id)) continue;
      seen.current.add(alert.id);
      if (enabled) void sound.play(volume);
    }
  }, [alerts, enabled, sound, volume]);

  return null;
}
