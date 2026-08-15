import { getFrigateConfig } from "./cameras.js";
import { resolveFrigateBase } from "./client.js";

export interface Go2rtcTarget {
  /** HTTP base for go2rtc API requests, e.g. http://host:1984/api */
  http: string;
  /** WebSocket base, e.g. ws://host:1984/api/ws */
  ws: string;
  via: "go2rtc-direct" | "frigate-proxy";
}

let cached: Go2rtcTarget | null = null;
let directPortOpen: boolean | null = null;
let streamsCache: { at: number; names: string[] } | null = null;

const ok = async (url: string, ms = 2500) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Resolve how go2rtc can be reached from inside this container.
 * Direct port 1984 is preferred (single, documented API surface); Frigate's
 * nginx proxy under /live/* is the fallback for hardened setups.
 */
export async function resolveGo2rtc(force = false): Promise<Go2rtcTarget | null> {
  if (cached && !force) return cached;
  const base = await resolveFrigateBase();
  if (!base) return null;

  const host = base.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  const direct = `http://${host}:1984`;
  directPortOpen = await ok(`${direct}/api/streams`);
  if (directPortOpen) {
    cached = { http: `${direct}/api`, ws: `ws://${host}:1984/api/ws`, via: "go2rtc-direct" };
    return cached;
  }

  // Frigate's nginx exposes go2rtc under /live/<mode>/api/*.
  cached = {
    http: `${base}/live/webrtc/api`,
    ws: `${base.replace(/^http/, "ws")}/live/webrtc/api/ws`,
    via: "frigate-proxy",
  };
  return cached;
}

export const go2rtcMeta = () => (cached ? { via: cached.via } : { via: null });

/** Stream names go2rtc actually serves. Empty when nothing is configured. */
export async function listGo2rtcStreams(force = false): Promise<string[]> {
  if (streamsCache && !force && Date.now() - streamsCache.at < 30_000) return streamsCache.names;
  const target = await resolveGo2rtc(force);
  if (!target) return [];
  try {
    const res = await fetch(`${target.http}/streams`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as Record<string, unknown>;
    const names = body && typeof body === "object" ? Object.keys(body) : [];
    streamsCache = { at: Date.now(), names };
    return names;
  } catch {
    streamsCache = { at: Date.now(), names: [] };
    return [];
  }
}

/**
 * Map a Frigate camera onto the go2rtc stream that carries it.
 * Frigate names streams however the user wrote them in `go2rtc: streams:`,
 * so candidates from the config are checked against the live stream list
 * instead of being assumed.
 */
export async function resolveStreamName(camera: string): Promise<{ name: string; matched: boolean }> {
  const candidates: string[] = [];
  try {
    const cfg = await getFrigateConfig();
    const live = cfg?.cameras?.[camera]?.live as
      | { stream_name?: string; streams?: Record<string, string> }
      | undefined;
    if (typeof live?.stream_name === "string" && live.stream_name) candidates.push(live.stream_name);
    if (live?.streams && typeof live.streams === "object") {
      for (const value of Object.values(live.streams)) {
        if (typeof value === "string" && value) candidates.push(value);
      }
    }
  } catch {
    /* config unavailable — fall through to name guesses */
  }
  candidates.push(camera, camera.toLowerCase(), camera.replace(/\s+/g, "_"));

  const names = await listGo2rtcStreams();
  if (!names.length) return { name: candidates[0] ?? camera, matched: false };

  for (const candidate of candidates) {
    const hit = names.find((name) => name.toLowerCase() === candidate.toLowerCase());
    if (hit) return { name: hit, matched: true };
  }
  return { name: candidates[0] ?? camera, matched: false };
}

/** Port / stream health used by the Settings diagnostics panel. */
export async function go2rtcDiagnostics() {
  const base = await resolveFrigateBase();
  const target = await resolveGo2rtc(true);
  const streams = await listGo2rtcStreams(true);
  return {
    frigateBase: base,
    frigatePort: 5000,
    frigateReachable: Boolean(base),
    go2rtcPort: 1984,
    go2rtcDirect: directPortOpen === true,
    via: target?.via ?? null,
    streamCount: streams.length,
    streams: streams.slice(0, 24),
  };
}
