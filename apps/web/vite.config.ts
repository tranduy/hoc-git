import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

const config = {
  plugins: [react()],
  test: {
    environment: "jsdom"
  }
};

export default defineConfig(config as typeof config & UserConfig);
