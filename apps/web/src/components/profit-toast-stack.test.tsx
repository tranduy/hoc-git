import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";
import { ProfitToastStack } from "./profit-toast-stack.js";

function alert(index: number): ProfitAlert {
  return { id: `alert-${index}`, identity: `identity-${index}`, observedAtMs: index,
    competition: "Premier League", matchName: `Alpha ${index} vs Beta ${index}`,
    marketName: "Chấp toàn trận", line: "-0.5", providers: ["SABA", "BTI"],
    legs: [{ provider: "SABA", selection: `Alpha ${index}` }, { provider: "BTI", selection: `Beta ${index}` }],
    roi: "0.1", worstCaseProfit: String(index * 10_000), currency: "VND", freshness: "FRESH" };
}

afterEach(cleanup);

describe("profit alert sound", () => {
  it("plays once for each new profitable ticket without rendering notifications", async () => {
    const play = vi.fn(async () => undefined);
    const view = render(<ProfitToastStack alerts={[alert(1), alert(2)]} sound={{ play }} volume={0.35} />);

    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(play).toHaveBeenNthCalledWith(1, 0.35);
    expect(play).toHaveBeenNthCalledWith(2, 0.35);
    expect(screen.queryByLabelText("Profitable ticket alerts")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    view.rerender(<ProfitToastStack alerts={[alert(1), alert(2)]} sound={{ play }} volume={0.35} />);
    expect(play).toHaveBeenCalledTimes(2);
    view.rerender(<ProfitToastStack alerts={[alert(1), alert(2), alert(3)]} sound={{ play }} volume={0.35} />);
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
