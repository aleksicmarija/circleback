/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Written by `npx convex deploy`/`convex dev`; points at the Convex backend. */
  readonly VITE_CONVEX_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
