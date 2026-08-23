import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],

  // The built assets are served by the Python package, so they are emitted
  // straight into it. Releases ship this directory pre-built: an end user
  // installs with pip or uv and never needs Node.
  build: {
    outDir: "../src/kathara_gui/static",
    emptyOutDir: true,
  },

  server: {
    // `npm run dev` serves the UI while the Python backend runs separately.
    // Proxying keeps the browser on one origin, so the Origin check in
    // main.py behaves exactly as it will in production.
    proxy: {
      "/api": {
        target: process.env.KGUI_BACKEND ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
