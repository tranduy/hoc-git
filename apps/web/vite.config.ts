import { defineConfig, type ProxyOptions, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

const trustedDashboardOrigin = process.env.VITE_ORIGIN?.trim() || "http://127.0.0.1:4311";
const apiProxy: ProxyOptions = {
  target: "http://127.0.0.1:4310",
  ws: true,
  configure(proxy) {
    proxy.on("proxyReqWs", (proxyRequest) => {
      if (!proxyRequest.headersSent) proxyRequest.setHeader("origin", trustedDashboardOrigin);
    });
  }
};

// The dashboard freezes for ~800ms per polling round and the work is pure
// main-thread computation, not network, payload or JSON. Chrome refuses the
// JS Self-Profiling API without this header, which left the hot function
// unknowable from outside and cost three wrong diagnoses. Same-origin, our
// own dashboard only.
const profilingHeaders = { "Document-Policy": "js-profiling" };

const config = {
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4311,
    headers: profilingHeaders,
    strictPort: true,
    allowedHosts: ["live.babiesbo.uk"],
    // Vite 8 enables browser-console forwarding when it detects an agent.
    // Errors injected by unrelated Chrome extensions would otherwise be
    // written to the live-stack log several times per second.
    forwardConsole: false,
    hmr: process.env.FIXTURE_MODE === "1" ? false : undefined,
    proxy: {
      "/api": apiProxy
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4311,
    strictPort: true,
    allowedHosts: ["live.babiesbo.uk"],
    headers: profilingHeaders,
    proxy: { "/api": apiProxy }
  },
  // Minified frames read as te/gu/cd in a profile, which is unusable for
  // finding a hot function. The dashboard is served from loopback to one
  // operator; a sourcemap costs nothing here and is the difference between
  // naming the cost and guessing at it.
  build: { sourcemap: true },
  test: {
    environment: "jsdom"
  }
};

export default defineConfig(config as typeof config & UserConfig);
