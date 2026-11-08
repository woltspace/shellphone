import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built once into ../dist, which room.py serves. Rooms never build anything.
// `npm run dev` talks to a dev room (room.py serve --dev) on ROOM, default port 4090.
const room = process.env.ROOM || "http://127.0.0.1:4090";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { proxy: Object.fromEntries(["/api", "/voice", "/files", "/join", "/sw.js", "/manifest.webmanifest", "/icon-180.png", "/icon-512.png", "/room-icon.png"].map((p) => [p, room])) },
});
