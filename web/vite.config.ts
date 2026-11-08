import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built once into ../dist, which room.py serves at /next/. Rooms never build anything.
// `npm run dev` talks to a dev room (room.py serve --dev) on ROOM, default port 4090.
const room = process.env.ROOM || "http://127.0.0.1:4090";
export default defineConfig({
  base: "/next/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { proxy: Object.fromEntries(["/api", "/voice", "/files", "/tabs", "/join", "/sw.js"].map((p) => [p, room])) },
});
