import type WebSocket from "ws";
import type { RawData } from "ws";

/** Keep cheap body fragments together, but yield after expensive catalog ingestion. */
export function onBudgetedBridgeMessage(socket: WebSocket,
  handler: (data: RawData, isBinary: boolean) => void,
  now: () => number = () => performance.now()): void {
  // ws exposes only an all-or-nothing public dispatch option. Start with its
  // safe asynchronous option, then permit synchronous continuation for at most
  // 8 ms. The installed receiver already owns ordering, buffering and backpressure.
  // If its internal shape changes, keep the configured asynchronous fallback.
  const receiver = (socket as unknown as { _receiver?: { _allowSynchronousEvents?: boolean } })._receiver;
  const supported = receiver !== undefined && typeof receiver._allowSynchronousEvents === "boolean";
  let deadline: number | null = null;
  let reset: ReturnType<typeof setImmediate> | null = null;
  socket.on("message", (data, isBinary) => {
    if (deadline === null) {
      deadline = now() + 8;
      reset = setImmediate(() => {
        deadline = null;
        reset = null;
        if (supported) receiver._allowSynchronousEvents = false;
      });
    }
    try { handler(data, isBinary); }
    finally { if (supported) receiver._allowSynchronousEvents = now() < deadline; }
  });
  socket.once("close", () => {
    if (reset !== null) clearImmediate(reset);
    reset = null;
    deadline = null;
  });
}
