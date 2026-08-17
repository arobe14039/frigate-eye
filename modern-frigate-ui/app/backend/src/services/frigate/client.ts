import { FRIGATE_CANDIDATES, config } from "../../config.js";
import { redactText } from "../../security/redact.js";

let resolvedBase: string | null = null;
let resolvedVia: "configured" | "auto" | null = null;
let lastError: string | null = null;
let lastConnectedAt: number | null = null;
let lastAttemptAt: number | null = null;
/** Exponential backoff so a Frigate outage is not answered with a probe storm. */
let failures = 0;
let nextAttemptAt = 0;

const BACKOFF_MS = [0, 1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

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

/**
 * Resolve the internal Frigate base URL: configured value first, then
 * discovery. Never returned to the browser — only used to build upstream
 * requests inside this container.
 */
export async function resolveFrigateBase(force = false): Promise<string | null> {
  if (resolvedBase && !force) return resolvedBase;
  // While Frigate is down, respect the backoff window instead of re-probing
  // every candidate on every request.
  if (!force && !resolvedBase && Date.now() < nextAttemptAt) return null;

  resolvedBase = null;
  resolvedVia = null;
  lastAttemptAt = Date.now();

  const candidates = config.configuredFrigateUrl
    ? [config.configuredFrigateUrl, ...FRIGATE_CANDIDATES]
    : FRIGATE_CANDIDATES;

  for (const [i, candidate] of candidates.entries()) {
    if (await probe(candidate)) {
      resolvedBase = candidate.replace(/\/$/, "");
      resolvedVia = config.configuredFrigateUrl && i === 0 ? "configured" : "auto";
      lastError = null;
      lastConnectedAt = Date.now();
      failures = 0;
      nextAttemptAt = 0;
      return resolvedBase;
    }
  }
  failures += 1;
  nextAttemptAt =
    Date.now() + (BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 30_000);
  lastError = "No reachable Frigate instance found on the internal network.";
  return null;
}

export const frigateMeta = () => ({ via: resolvedVia, lastError, lastConnectedAt, lastAttemptAt });

/** Test seam. */
export const __resetFrigateClient = () => {
  resolvedBase = null;
  resolvedVia = null;
  failures = 0;
  nextAttemptAt = 0;
};

export class FrigateUnavailableError extends Error {
  constructor(message = "Frigate is temporarily unavailable") {
    super(redactText(message));
    this.name = "FrigateUnavailableError";
  }
}

/** Raw request against the Frigate API. Internal use only. */
export async function frigateFetch(path: string, init?: RequestInit, timeoutMs = 8000) {
  const base = await resolveFrigateBase();
  if (!base) throw new FrigateUnavailableError();
  const res = await withTimeout(`${base}${path}`, init, timeoutMs);
  if (!res.ok) throw new FrigateUnavailableError(`Frigate returned ${res.status}`);
  return res;
}

export async function frigateJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await frigateFetch(path, { headers: { accept: "application/json" } }, timeoutMs);
  return (await res.json()) as T;
}
