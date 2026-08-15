import { resolveFrigateBase } from "./client.js";

export interface Go2rtcTarget {
  /** HTTP base for go2rtc API requests, e.g. http://host:1984/api */
  http: string;
  /** WebSocket base, e.g. ws://host:1984/api/ws */
  ws: string;
  via: "go2rtc-direct" | "frigate-proxy";
}

let cached: Go2rtcTarget | null = null;

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
  if (await ok(`${direct}/api/streams`)) {
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
