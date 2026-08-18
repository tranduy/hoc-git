import { supportsDomCatalogCapture } from "./dom-catalog-host.js";

const CHANNEL = "__FIELDLINE_PROVIDER_CAPTURE_V1__";
const MAX_BODY_CHARS = 12_000_000;

type CaptureDetail = {
  readonly channel: typeof CHANNEL;
  readonly transport: "WS" | "HTTP" | "DOM";
  readonly resourceType: "WebSocket" | "XHR" | "Fetch" | "DOM";
  readonly url: string;
  readonly body: string;
  readonly opcode?: number;
};

function publish(detail: CaptureDetail): void {
  if (detail.body.length > MAX_BODY_CHARS) return;
  window.postMessage(detail, location.origin);
}

function isCatalogUrl(value: string): boolean {
  try {
    const url = new URL(value, location.href);
    return /(?:api|event|sport|odd|market|price|line|fixture|match|league|competition|getse|delta)/iu
      .test(`${url.pathname}${url.search}`);
  } catch { return false; }
}

const NativeWebSocket = window.WebSocket;
class ObservedWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    const socketUrl = String(url);
    this.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") {
        publish({ channel: CHANNEL, transport: "WS", resourceType: "WebSocket", url: socketUrl,
          body: event.data, opcode: 1 });
      }
    });
  }
}
Object.defineProperties(ObservedWebSocket, {
  CONNECTING: { value: NativeWebSocket.CONNECTING }, OPEN: { value: NativeWebSocket.OPEN },
  CLOSING: { value: NativeWebSocket.CLOSING }, CLOSED: { value: NativeWebSocket.CLOSED }
});
window.WebSocket = ObservedWebSocket;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const response = await nativeFetch(...args);
  try {
    const url = response.url || String(args[0] instanceof Request ? args[0].url : args[0]);
    if (!isCatalogUrl(url)) return response;
    const body = await response.clone().text();
    publish({ channel: CHANNEL, transport: "HTTP", resourceType: "Fetch", url, body });
  } catch { /* Opaque, streaming, or non-text responses are intentionally ignored. */ }
  return response;
};

const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]): void {
  const absoluteUrl = new URL(String(url), location.href).href;
  this.addEventListener("load", () => {
    try {
      if (!isCatalogUrl(this.responseURL || absoluteUrl)) return;
      if (this.responseType !== "" && this.responseType !== "text") return;
      publish({ channel: CHANNEL, transport: "HTTP", resourceType: "XHR", url: this.responseURL || absoluteUrl,
        body: this.responseText });
    } catch { /* Cross-origin or binary response. */ }
  }, { once: true });
  Reflect.apply(nativeOpen, this, [method, url, ...rest]);
};

declare const __FIELDLINE_CMD_CAPTURE_EXPRESSION__: unknown;
function capturePublicCatalog(): unknown {
  return __FIELDLINE_CMD_CAPTURE_EXPRESSION__;
}

if (supportsDomCatalogCapture(location.hostname)) {
  let previous = "";
  let lastSentAtMs = 0;
  setInterval(() => {
    try {
      const body = String(capturePublicCatalog());
      const nowMs = Date.now();
      if (!body || body === "[]" || (body === previous && nowMs - lastSentAtMs < 4_000)) return;
      previous = body;
      lastSentAtMs = nowMs;
      publish({ channel: CHANNEL, transport: "DOM", resourceType: "DOM", url: location.href, body });
    } catch { /* A navigating frame is retried by the next bounded poll. */ }
  }, 2_000);
}
