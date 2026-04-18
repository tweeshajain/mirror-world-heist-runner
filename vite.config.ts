import { defineConfig } from "vite";

export default defineConfig({
  // Uncommon default port — avoids clashing with other Vite apps on 5173 / 5180.
  server: { host: true, port: 8765, strictPort: false },
  build: { target: "es2022" },
});
