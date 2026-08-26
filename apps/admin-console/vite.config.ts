import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget =
  process.env.VITE_API_PROXY_TARGET?.replace(/\/$/, "") ??
  "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/healthz": apiTarget,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": apiTarget,
      "/healthz": apiTarget,
    },
  },
});
