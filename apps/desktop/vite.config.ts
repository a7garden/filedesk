import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// tauri.conf.json 의 devUrl 과 같은 포트. 다른 앱(oxb 5173)과 겹치지 않게 5180.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5180, strictPort: true },
  build: { target: "es2022" },
});
