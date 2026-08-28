import { useEffect, useRef } from "react";
import { NotificationSound } from "./notification-sound.js";

export interface AlertSound {
  play(volume?: number): Promise<void> | void;
  dispose(): void;
}

const createNotificationSound = (): AlertSound => new NotificationSound();

export function useNotificationSound(factory: () => AlertSound = createNotificationSound): Pick<AlertSound, "play"> {
  const active = useRef<AlertSound | null>(null);
  const pending = useRef(false);
  const pendingVolume = useRef<number | undefined>(undefined);
  const facade = useRef<Pick<AlertSound, "play">>({
    play: (volume) => {
      if (active.current !== null) return active.current.play(volume);
      pending.current = true;
      pendingVolume.current = volume;
    }
  });

  useEffect(() => {
    const sound = factory();
    active.current = sound;
    if (pending.current) {
      pending.current = false;
      void sound.play(pendingVolume.current);
      pendingVolume.current = undefined;
    }
    return () => {
      if (active.current === sound) active.current = null;
      sound.dispose();
    };
  }, [factory]);

  return facade.current;
}
