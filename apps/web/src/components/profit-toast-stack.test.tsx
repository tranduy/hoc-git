import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";
import { ProfitToastStack } from "./profit-toast-stack.js";

function alert(index: number): ProfitAlert {
  return { id: `alert-${index}`, identity: `identity-${index}`, createdAtMs: index,
    freshness: "FRESH", event: { event: { participantA: `Alpha ${index}`, participantB: `Beta ${index}` } },
    ticket: { plan: { worstCaseProfit: String(index * 10_000), roi: "0.1" } } } as unknown as ProfitAlert;
}

afterEach(cleanup);

describe("profit alert sound", () => {
  it("plays once for each new profitable ticket without rendering notifications", async () => {
    const play = vi.fn(async () => undefined);
    const view = render(<ProfitToastStack alerts={[alert(1), alert(2)]} sound={{ play }} />);

    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Profitable ticket alerts")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    view.rerender(<ProfitToastStack alerts={[alert(1), alert(2)]} sound={{ play }} />);
    expect(play).toHaveBeenCalledTimes(2);
    view.rerender(<ProfitToastStack alerts={[alert(1), alert(2), alert(3)]} sound={{ play }} />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(3));
  });

  it("never plays while notification sound is disabled", async () => {
    const play = vi.fn(async () => undefined);
    const view = render(<ProfitToastStack alerts={[alert(1)]} enabled={false} sound={{ play }} />);
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();

    view.rerender(<ProfitToastStack alerts={[alert(1), alert(2)]} enabled={false} sound={{ play }} />);
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
  });
});
