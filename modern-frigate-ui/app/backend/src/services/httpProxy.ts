import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export interface PipeOptions {
  /** Headers forwarded to the upstream request (e.g. `range`). */
  headers?: Record<string, string>;
  /** Cache-Control written on the response. */
  cacheControl?: string;
  /** How long to wait for upstream headers before aborting. */
  headerTimeoutMs?: number;
}

/**
 * Stream an upstream response body straight through to the client.
 *
 * The body is a Web ReadableStream, which Fastify cannot send directly — it is
 * converted to a Node stream and the reply is hijacked so nothing can attempt a
 * second (already-sent) reply. Returns `null` when the upstream refused, so the
 * caller can still answer with a status code.
 */
export function createPipe(app: { log: any }) {
  return async function pipe(
    url: string,
    reply: any,
    log: Record<string, unknown>,
    options: PipeOptions = {},
  ) {
    const abort = new AbortController();
    const headerTimeout = setTimeout(
      () => abort.abort(new Error("upstream headers timed out")),
      options.headerTimeoutMs ?? 8_000,
    );
    const onClientClose = () => abort.abort(new Error("client disconnected"));
    reply.raw.once("close", onClientClose);
    try {
      const upstream = await fetch(url, {
        headers: { accept: "*/*", ...(options.headers ?? {}) },
        signal: abort.signal,
      });
      clearTimeout(headerTimeout);
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel().catch(() => undefined);
        app.log.warn({ ...log, url, status: upstream.status }, "http proxy: upstream rejected");
        return null;
      }
      reply.raw.statusCode = upstream.status;
      for (const header of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(header);
        if (value) reply.raw.setHeader(header, value);
      }
      if (!reply.raw.getHeader("content-type")) {
        reply.raw.setHeader("content-type", "application/octet-stream");
      }
      reply.raw.setHeader("cache-control", options.cacheControl ?? "no-store");
      reply.hijack();
      await pipeline(Readable.fromWeb(upstream.body as any), reply.raw, { signal: abort.signal });
      return reply;
    } catch (error) {
      const disconnected =
        reply.raw.destroyed || abort.signal.reason?.message === "client disconnected";
      if (!disconnected) {
        app.log.error({ ...log, url, err: (error as Error).message }, "http proxy: failed");
      }
      if (reply.sent || reply.raw.headersSent) return reply;
      return null;
    } finally {
      clearTimeout(headerTimeout);
      reply.raw.off("close", onClientClose);
    }
  };
}
