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

const config = {
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4311,
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
  test: {
    environment: "jsdom"
  }
};

export default defineConfig(config as typeof config & UserConfig);
