import { TtlCache } from "../cache.js";
import { frigateJson } from "./client.js";
import type { Camera } from "./types.js";

const configCache = new TtlCache<any>(30_000, 4);
const statsCache = new TtlCache<any>(5_000, 4);

export const getFrigateConfig = () => configCache.wrap("config", () => frigateJson<any>("/api/config"));
export const getFrigateStats = () => statsCache.wrap("stats", () => frigateJson<any>("/api/stats"));

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export async function listCameras(): Promise<Camera[]> {
  const [cfg, stats] = await Promise.all([
    getFrigateConfig(),
    getFrigateStats().catch(() => ({}) as any),
  ]);

  const cameras = cfg?.cameras ?? {};
  return Object.entries<any>(cameras)
    .filter(([, cam]) => cam?.enabled !== false)
    .map(([id, cam]) => {
      const camStats = stats?.cameras?.[id];
      return {
        id,
        name: id,
        displayName: titleCase(cam?.friendly_name ?? id),
        online: camStats ? Number(camStats.camera_fps ?? 0) > 0 : true,
        detect: cam?.detect
          ? {
              width: cam.detect.width,
              height: cam.detect.height,
              fps: cam.detect.fps,
            }
          : undefined,
        audioEnabled: Boolean(cam?.audio?.enabled),
        recordEnabled: Boolean(cam?.record?.enabled),
        zones: Object.keys(cam?.zones ?? {}),
        lastUpdated: Date.now(),
      } satisfies Camera;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getCamera(id: string): Promise<Camera | null> {
  const cameras = await listCameras();
  return cameras.find((c) => c.id === id) ?? null;
}

/** Distinct object labels tracked by the running Frigate config (never hardcoded). */
export async function listLabels(): Promise<string[]> {
  const cfg = await getFrigateConfig();
  const labels = new Set<string>();
  for (const value of cfg?.objects?.track ?? []) labels.add(String(value));
  for (const cam of Object.values<any>(cfg?.cameras ?? {})) {
    for (const value of cam?.objects?.track ?? []) labels.add(String(value));
  }
  return [...labels].sort();
}
