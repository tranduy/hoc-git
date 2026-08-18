import { createRuntimeRelay } from "./runtime-relay.js";

const CHANNEL = "__FIELDLINE_PROVIDER_CAPTURE_V1__";
const relay = createRuntimeRelay((message) => chrome.runtime.sendMessage(message));

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin || !event.data || typeof event.data !== "object") return;
  const detail = event.data as Record<string, unknown>;
  if (detail.channel !== CHANNEL || typeof detail.url !== "string" || typeof detail.body !== "string") return;
  if (detail.transport === "WS" && detail.resourceType === "WebSocket") {
    relay({ kind: "NETWORK_CAPTURE", transport: "WS", resourceType: "WebSocket",
      url: detail.url, body: detail.body, opcode: detail.opcode === 2 ? 2 : 1 });
  } else if (detail.transport === "HTTP" && (detail.resourceType === "XHR" || detail.resourceType === "Fetch")) {
    relay({ kind: "NETWORK_CAPTURE", transport: "HTTP",
      resourceType: detail.resourceType, url: detail.url, body: detail.body });
  } else if (detail.transport === "DOM" && detail.resourceType === "DOM") {
    relay({ kind: "NETWORK_CAPTURE", transport: "DOM", resourceType: "DOM",
      url: detail.url, body: detail.body });
  }
});
