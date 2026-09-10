import { expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";

it("yields between a burst of incoming WebSocket messages without changing their order", async () => {
  const app = buildApp(createFixtureRuntime(1_000));
  const order: string[] = [];
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  void app.register(async (scope) => {
    scope.get("/test-fairness", { websocket: true }, (socket) => {
      socket.on("message", (data) => {
        const index = data.toString();
        order.push(`message-${index}`);
        setImmediate(() => order.push(`yield-${index}`));
        if (index === "2") complete();
      });
    });
  });
  await app.ready();
  const socket = await app.injectWS("/test-fairness");
  try {
    socket.send("0");
    socket.send("1");
    socket.send("2");
    await completed;
    expect(order.filter((item) => item.startsWith("message"))).toEqual(["message-0", "message-1", "message-2"]);
    expect(order.indexOf("yield-0")).toBeGreaterThan(order.indexOf("message-0"));
    expect(order.indexOf("yield-0")).toBeLessThan(order.indexOf("message-1"));
    expect(order.indexOf("yield-1")).toBeLessThan(order.indexOf("message-2"));
  } finally {
    socket.terminate();
    await app.close();
  }
});
