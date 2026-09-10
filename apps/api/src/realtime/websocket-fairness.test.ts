import { expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";
import { onBudgetedBridgeMessage } from "../chrome-bridge/bridge-message-budget.js";

it.each([10, 2])("yields when accumulated bridge work reaches the budget (%i ms/message)", async (cost) => {
  const app = buildApp(createFixtureRuntime(1_000));
  const order: string[] = [];
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  let clock = 0;
  void app.register(async (scope) => {
    scope.get("/test-fairness", { websocket: true }, (socket) => {
      onBudgetedBridgeMessage(socket, (data) => {
        clock += cost;
        const index = data.toString();
        order.push(`message-${index}`);
        setImmediate(() => order.push(`yield-${index}`));
        if (index === "9") complete();
      }, () => clock);
    });
  });
  await app.ready();
  const socket = await app.injectWS("/test-fairness");
  try {
    for (let index = 0; index < 10; index++) socket.send(String(index));
    await completed;
    expect(order.filter((item) => item.startsWith("message"))).toEqual(
      Array.from({ length: 10 }, (_, index) => `message-${index}`));
    expect(order.indexOf("yield-0")).toBeGreaterThan(order.indexOf("message-0"));
    const firstYieldAfter = cost >= 8 ? 0 : 3;
    expect(order.indexOf(`yield-${firstYieldAfter}`)).toBeLessThan(order.indexOf(`message-${firstYieldAfter + 1}`));
  } finally {
    socket.terminate();
    await app.close();
  }
});

it("assembles cheap fragment bursts without requiring an I/O turn for every fragment", async () => {
  const app = buildApp(createFixtureRuntime(1_000));
  const received: number[] = [];
  let turns = 0;
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  void app.register(async (scope) => {
    scope.get("/test-fragments", { websocket: true }, (socket) => {
      onBudgetedBridgeMessage(socket, (data) => {
        received.push(Number(data.toString()));
        setImmediate(() => { turns++; });
        if (received.length === 100) complete();
      }, () => 0);
    });
  });
  await app.ready();
  const socket = await app.injectWS("/test-fragments");
  try {
    for (let index = 0; index < 100; index++) socket.send(String(index));
    await completed;
    expect(received).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(turns).toBeLessThan(10);
  } finally {
    socket.terminate();
    await app.close();
  }
});
