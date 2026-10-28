import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre-gl resolves its worker via import.meta.url — pre-bundling moves
  // it into .vite/deps where maplibre-gl-worker.mjs doesn't exist (404).
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: [".trycloudflare.com", ".ngrok-free.dev"],
    proxy: {
      "/api": { target: "http://localhost:4001", ws: true },
      "/socket.io": { target: "http://localhost:4001", ws: true },
    },
  },
})
