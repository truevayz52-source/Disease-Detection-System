import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
