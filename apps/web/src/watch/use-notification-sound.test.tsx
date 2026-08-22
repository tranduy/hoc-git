import { StrictMode, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNotificationSound, type AlertSound } from "./use-notification-sound.js";

afterEach(cleanup);

describe("useNotificationSound", () => {
  it("uses a live sound instance after the StrictMode effect cleanup and replay", async () => {
    const instances: Array<{ play: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
    const factory = (): AlertSound => {
      const instance = { play: vi.fn(async () => undefined), dispose: vi.fn() };
      instances.push(instance);
      return instance;
    };
    let active: Pick<AlertSound, "play"> | null = null;
    function Harness() {
      const sound = useNotificationSound(factory);
      useEffect(() => { active = sound; }, [sound]);
      return null;
    }

    render(<StrictMode><Harness /></StrictMode>);
    await act(async () => { await active!.play(); });

    expect(instances).toHaveLength(2);
    expect(instances[0]!.dispose).toHaveBeenCalledOnce();
    expect(instances[0]!.play).not.toHaveBeenCalled();
    expect(instances[1]!.play).toHaveBeenCalledOnce();
  });

  it("delivers an alert requested by a child before the parent sound effect is ready", async () => {
    const play = vi.fn(async () => undefined);
    const factory = (): AlertSound => ({ play, dispose: vi.fn() });
    function Child({ sound }: { readonly sound: Pick<AlertSound, "play"> }) {
      useEffect(() => { void sound.play(); }, [sound]);
      return null;
    }
    function Harness() {
      const sound = useNotificationSound(factory);
      return <Child sound={sound} />;
    }

    render(<Harness />);
    await act(async () => undefined);

    expect(play).toHaveBeenCalledOnce();
  });
});
