import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

const config = {
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4311,
    strictPort: true,
    hmr: process.env.FIXTURE_MODE === "1" ? false : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4310",
        ws: true
      }
    }
  },
  test: {
    environment: "jsdom"
  }
};

export default defineConfig(config as typeof config & UserConfig);
