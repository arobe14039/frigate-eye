import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Small per-route token bucket.
 *
 * Purpose is resource protection, not authentication: a runaway browser loop or
 * an accidental export storm must not be able to hammer the NVR. Video
 * playback paths are deliberately NOT limited here — HLS/MSE issue many
 * legitimate segment requests per minute.
 */
interface Bucket {
  tokens: number;
  updated: number;
}

export function createRateLimiter(options: { limit: number; windowMs: number; name: string }) {
  const buckets = new Map<string, Bucket>();

  return async function guard(request: FastifyRequest, reply: FastifyReply) {
    const key = `${request.socket.remoteAddress ?? "unknown"}:${
      (request.headers["x-remote-user-id"] as string | undefined) ?? "-"
    }`;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: options.limit, updated: now };
    const refill = ((now - bucket.updated) / options.windowMs) * options.limit;
    bucket.tokens = Math.min(options.limit, bucket.tokens + refill);
    bucket.updated = now;

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      request.log.warn({ route: options.name }, "rate limit hit");
      return reply
        .code(429)
        .header("retry-after", Math.ceil(options.windowMs / 1000))
        .send({ error: "RATE_LIMITED", message: "Too many requests. Please slow down." });
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    if (buckets.size > 1000) buckets.clear();
    return undefined;
  };
}

/** Per-route policies. Exports get the strongest protection. */
export const limiters = {
  exports: createRateLimiter({ limit: 5, windowMs: 60_000, name: "exports" }),
  diagnostics: createRateLimiter({ limit: 20, windowMs: 60_000, name: "diagnostics" }),
  snapshots: createRateLimiter({ limit: 300, windowMs: 60_000, name: "snapshots" }),
  writes: createRateLimiter({ limit: 60, windowMs: 60_000, name: "writes" }),
};
