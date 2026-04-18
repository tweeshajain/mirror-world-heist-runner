import { defineConfig } from "vite";

// GitHub Pages project URL: https://<user>.github.io/<repo>/
const raw = process.env.VITE_BASE;
const base = raw ? (raw.endsWith("/") ? raw : `${raw}/`) : "/";

export default defineConfig({
  base,
  // Uncommon default port — avoids clashing with other Vite apps on 5173 / 5180.
  server: { host: true, port: 8765, strictPort: false },
  build: { target: "es2022" },
});
