import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port during development.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "chrome105", sourcemap: false },
});
