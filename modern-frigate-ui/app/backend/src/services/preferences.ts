import { mkdir, readFile, rename, writeFile, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { config } from "../config.js";

export const preferencesSchema = z.object({
  favorites: z.array(z.string().max(64)).max(64).default([]),
  cameraOrder: z.array(z.string().max(64)).max(64).default([]),
  gridDensity: z.enum(["compact", "comfortable"]).default("comfortable"),
  previewRefresh: z.enum(["off", "slow", "normal", "fast"]).default("normal"),
  clock: z.enum(["12h", "24h"]).default("12h"),
  defaultFilter: z.string().max(32).default("all"),
  timelineZoom: z.enum(["15m", "1h", "6h", "24h"]).default("1h"),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = (): Preferences => preferencesSchema.parse({});

const file = () => join(config.dataDir, "preferences.json");
type Store = Record<string, Preferences>;
let cache: Store | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(file(), "utf8")) as Store;
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * Atomic persistence: write a temp file, flush it to disk, then rename over the
 * real file. A crash mid-write can therefore never truncate existing
 * preferences. Failures are thrown, never swallowed — the API must not report
 * success for a save that did not land.
 */
async function persist(store: Store) {
  const target = file();
  const tmp = `${target}.${process.pid}.tmp`;
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  const handle = await open(tmp, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, target);
  cache = store;
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const store = await load();
  return preferencesSchema.parse(store[userId] ?? {});
}

export async function savePreferences(
  userId: string,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const store = { ...(await load()) };
  const next = preferencesSchema.parse({ ...(store[userId] ?? {}), ...patch });
  store[userId] = next;
  await persist(store);
  return next;
}

/** Test seam. */
export const __resetPreferenceCache = () => {
  cache = null;
};
