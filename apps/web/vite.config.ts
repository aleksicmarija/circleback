import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // `npx convex dev` writes VITE_CONVEX_URL into .env.local at the REPO ROOT,
  // not inside this app, so point Vite there.
  envDir: resolve(here, "../.."),
  resolve: {
    alias: {
      "@backend": resolve(here, "../../packages/backend/convex"),
    },
  },
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: true },
});
