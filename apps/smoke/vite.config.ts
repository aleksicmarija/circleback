import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Same as apps/web: VITE_CONVEX_URL lives in .env.local at the repo root.
  envDir: resolve(here, "../.."),
  resolve: {
    alias: {
      "@backend": resolve(here, "../../packages/backend/convex"),
    },
  },
  server: { port: 5174 },
  build: { outDir: "dist", sourcemap: true },
});
