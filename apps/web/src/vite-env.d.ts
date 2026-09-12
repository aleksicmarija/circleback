/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which backend the client talks to. "local" (default) runs the simulation in a Web Worker. */
  readonly VITE_BACKEND?: "local" | "convex";
  /** Local backend only: round-trip latency to simulate, in ms. Useful for testing interpolation. */
  readonly VITE_FAKE_LATENCY_MS?: string;
  /** Written by `npx convex deploy`/`convex dev`; points at the Convex backend. */
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
