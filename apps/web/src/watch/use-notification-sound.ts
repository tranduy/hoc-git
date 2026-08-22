import { useEffect, useRef } from "react";
import { NotificationSound } from "./notification-sound.js";

export interface AlertSound {
  play(): Promise<void> | void;
  dispose(): void;
}

const createNotificationSound = (): AlertSound => new NotificationSound();

export function useNotificationSound(factory: () => AlertSound = createNotificationSound): Pick<AlertSound, "play"> {
  const active = useRef<AlertSound | null>(null);
  const pending = useRef(false);
  const facade = useRef<Pick<AlertSound, "play">>({
    play: () => {
      if (active.current !== null) return active.current.play();
      pending.current = true;
    }
  });

  useEffect(() => {
    const sound = factory();
    active.current = sound;
    if (pending.current) {
      pending.current = false;
      void sound.play();
    }
    return () => {
      if (active.current === sound) active.current = null;
      sound.dispose();
    };
  }, [factory]);

  return facade.current;
}
