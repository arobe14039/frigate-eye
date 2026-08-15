import { FRIGATE_CANDIDATES, config } from "../../config.js";

let resolvedBase: string | null = null;
let resolvedVia: "configured" | "auto" | null = null;
let lastError: string | null = null;

const withTimeout = async (url: string, init: RequestInit = {}, ms = 5000) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
};

const probe = async (base: string) => {
  try {
    const res = await withTimeout(`${base.replace(/\/$/, "")}/api/version`, {}, 2500);
    return res.ok;
  } catch {
    return false;
  }
};

/** Resolve the internal Frigate base URL: configured value first, then discovery. */
export async function resolveFrigateBase(force = false): Promise<string | null> {
  if (resolvedBase && !force) return resolvedBase;
  resolvedBase = null;
  resolvedVia = null;

  const candidates = config.configuredFrigateUrl
    ? [config.configuredFrigateUrl, ...FRIGATE_CANDIDATES]
    : FRIGATE_CANDIDATES;

  for (const [i, candidate] of candidates.entries()) {
    if (await probe(candidate)) {
      resolvedBase = candidate.replace(/\/$/, "");
      resolvedVia = config.configuredFrigateUrl && i === 0 ? "configured" : "auto";
      lastError = null;
      return resolvedBase;
    }
  }
  lastError = "No reachable Frigate instance found on the internal network.";
  return null;
}

export const frigateMeta = () => ({ via: resolvedVia, lastError });

export class FrigateUnavailableError extends Error {
  constructor(message = "Frigate is temporarily unavailable") {
    super(message);
    this.name = "FrigateUnavailableError";
  }
}

/** Raw request against the Frigate API. Internal use only. */
export async function frigateFetch(path: string, init?: RequestInit, timeoutMs = 8000) {
  const base = await resolveFrigateBase();
  if (!base) throw new FrigateUnavailableError();
  const res = await withTimeout(`${base}${path}`, init, timeoutMs);
  if (!res.ok) throw new FrigateUnavailableError(`Frigate returned ${res.status} for ${path}`);
  return res;
}

export async function frigateJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await frigateFetch(path, { headers: { accept: "application/json" } }, timeoutMs);
  return (await res.json()) as T;
}
