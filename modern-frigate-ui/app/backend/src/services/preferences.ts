import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { config } from "../config.js";

export const preferencesSchema = z.object({
  favorites: z.array(z.string()).max(64).default([]),
  cameraOrder: z.array(z.string()).max(64).default([]),
  gridDensity: z.enum(["compact", "comfortable"]).default("comfortable"),
  previewRefresh: z.enum(["off", "slow", "normal", "fast"]).default("normal"),
  clock: z.enum(["12h", "24h"]).default("12h"),
  defaultFilter: z.string().max(32).default("all"),
  timelineZoom: z.enum(["15m", "1h", "6h", "24h"]).default("1h"),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = (): Preferences => preferencesSchema.parse({});

const file = join(config.dataDir, "preferences.json");
type Store = Record<string, Preferences>;
let cache: Store | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(file, "utf8")) as Store;
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(store: Store) {
  cache = store;
  await mkdir(config.dataDir, { recursive: true }).catch(() => {});
  await writeFile(file, JSON.stringify(store, null, 2), "utf8").catch(() => {});
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const store = await load();
  return preferencesSchema.parse(store[userId] ?? {});
}

export async function savePreferences(
  userId: string,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const store = await load();
  const next = preferencesSchema.parse({ ...(store[userId] ?? {}), ...patch });
  store[userId] = next;
  await persist(store);
  return next;
}
