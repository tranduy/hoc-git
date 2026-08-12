import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";
import { ProfitToastStack } from "./profit-toast-stack.js";

function alert(index: number): ProfitAlert {
  return { id: `alert-${index}`, identity: `identity-${index}`, createdAtMs: index,
    event: { event: { participantA: `Alpha ${index}`, participantB: `Beta ${index}` } },
    ticket: { plan: { worstCaseProfit: String(index * 10_000), roi: "0.1" } } } as unknown as ProfitAlert;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ProfitToastStack", () => {
  it("keeps the newest five at the bottom, opens exact alerts and expires at five seconds", async () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const play = vi.fn(async () => undefined);
    render(<ProfitToastStack alerts={[1, 2, 3, 4, 5, 6].map(alert)} onOpen={onOpen} sound={{ play }} />);
    await act(async () => undefined);

    const toasts = screen.getAllByRole("button", { name: /Open profitable ticket/u });
    expect(toasts).toHaveLength(5);
    expect(toasts[0]?.textContent).toContain("Alpha 2 vs Beta 2");
    expect(toasts[4]?.textContent).toContain("Alpha 6 vs Beta 6");
    fireEvent.click(toasts[4]!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "alert-6" }));
    expect(play).toHaveBeenCalledTimes(6);

    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(screen.getAllByRole("button", { name: /Open profitable ticket/u })).toHaveLength(5);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryAllByRole("button", { name: /Open profitable ticket/u })).toHaveLength(0);
  });
});
