import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * Serves the spectator page at a clean `/spectate` URL in dev and preview.
 * Vite's SPA fallback would otherwise hand `/spectate` to index.html. In
 * production the same mapping is a rewrite rule in render.yaml.
 */
function cleanSpectateUrl(): Plugin {
  const rewrite = (server: { middlewares: { use(fn: (req: { url?: string }, res: unknown, next: () => void) => void): void } }) => {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/spectate(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/spectate/, "/spectate/index.html");
      next();
    });
  };
  return { name: "clean-spectate-url", configureServer: rewrite, configurePreviewServer: rewrite };
}

export default defineConfig({
  plugins: [cleanSpectateUrl()],
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
        // Built as spectate/index.html so `/spectate` works on any static host.
        spectate: resolve(here, "spectate/index.html"),
      },
    },
  },
});
