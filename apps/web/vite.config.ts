import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // .env.local lives at the REPO ROOT (npx convex dev writes it there).
  envDir: resolve(here, "../.."),
  resolve: {
    // Keep in sync with "paths" in tsconfig.base.json.
    alias: {
      "@core": resolve(here, "../../packages/game-core/src/index.ts"),
      "@server": resolve(here, "../../packages/local-server/src"),
      "@backend": resolve(here, "../../packages/backend/convex"),
    },
  },
  server: { port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Two pages: the game and the spectator screen.
    rolldownOptions: {
      input: {
        main: resolve(here, "index.html"),
        watch: resolve(here, "watch.html"),
      },
    },
  },
});
