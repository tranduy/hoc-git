import { describe, expect, it } from "vitest";
import { captureScrollAnchor, restoreScrollAnchor } from "./stable-scroll-anchor.js";

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top,
    x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

describe("stable scroll anchor", () => {
  it("keeps the same visible match at the same viewport offset after ranked rows reorder", () => {
    const container = document.createElement("div");
    const above = document.createElement("article");
    const visible = document.createElement("article");
    above.dataset.scrollKey = "event-a";
    visible.dataset.scrollKey = "event-b";
    container.append(above, visible);
    container.scrollTop = 200;
    container.getBoundingClientRect = () => rect(100, 500);
    above.getBoundingClientRect = () => rect(40, 90);
    visible.getBoundingClientRect = () => rect(120, 180);

    const anchor = captureScrollAnchor(container);
    expect(anchor).toEqual({ key: "event-b", offset: 20 });

    visible.getBoundingClientRect = () => rect(170, 230);
    restoreScrollAnchor(container, anchor);

    expect(container.scrollTop).toBe(250);
  });

  it("does not pin an old match while the user is at the top of the ranked list", () => {
    const container = document.createElement("div");
    container.scrollTop = 0;

    expect(captureScrollAnchor(container)).toBeNull();
  });

  it("always returns the realtime match list to its left edge", () => {
    const container = document.createElement("div");
    container.scrollLeft = 48;

    restoreScrollAnchor(container, null);

    expect(container.scrollLeft).toBe(0);
  });
});
