import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as constants from "../constants.js";
import type * as game from "../game.js";
import type * as rooms from "../rooms.js";
import type * as tick from "../tick.js";

declare const fullApi: ApiFromModules<{
  constants: typeof constants;
  game: typeof game;
  rooms: typeof rooms;
  tick: typeof tick;
}>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
