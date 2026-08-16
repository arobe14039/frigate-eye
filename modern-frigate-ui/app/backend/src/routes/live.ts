import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import WebSocket from "ws";
import { resolveFrigateBase } from "../services/frigate/client.js";
import { parseQuality, resolveGo2rtc, resolveStreamSrc } from "../services/frigate/go2rtc.js";
import type { StreamQuality } from "../services/frigate/go2rtc.js";


/**
 * Live streaming adapter. go2rtc (bundled with Frigate) is reached only from
 * this container; the browser talks to relative `api/live/*` paths that work
 * unchanged behind Home Assistant Ingress.
 *
 * The `:stream` parameter is the Frigate camera name — the matching go2rtc
 * stream name is resolved here against go2rtc's live stream list, because a
 * mismatch is what makes go2rtc answer 404 for every request.
 */
export async function registerLive(app: FastifyInstance) {
  /** Upstream websocket URL for a signalling mode. */
  const upstreamWsUrl = async (mode: "webrtc" | "mse", camera: string, quality: StreamQuality) => {
    const target = await resolveGo2rtc();
    if (!target) return null;
    const { name, matched } = await resolveStreamSrc(camera, quality);
    if (!matched) {
      app.log.warn({ mode, camera, tried: name }, "live relay: no matching go2rtc stream");
      return null;
    }
    const query = `?src=${encodeURIComponent(name)}`;
    if (target.via === "go2rtc-direct") return `${target.ws}${query}`;
    const base = await resolveFrigateBase();
    if (!base) return null;
    return `${base.replace(/^http/, "ws")}/live/${mode}/api/ws${query}`;
  };

  const relay = (mode: "webrtc" | "mse") => async (connection: any, request: any) => {
    const maxBufferedBytes = 4 * 1024 * 1024;
    const client: WebSocket = connection.socket ?? connection;
    const src = String((request.params as any).stream ?? "");
    const quality = parseQuality((request.query as any)?.q);
    const upstreamUrl = src ? await upstreamWsUrl(mode, src, quality) : null;
    if (!upstreamUrl) {
      app.log.warn({ mode, src }, "live relay: go2rtc not reachable");
      try {
        client.close(1011, "go2rtc_unavailable");
      } catch {}
      return;
    }

    app.log.info({ mode, src, upstreamUrl }, "live relay: connecting upstream");
    const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 8000 });
    const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
    let closed = false;
    const closeBoth = (reason: string) => {
      if (closed) return;
      closed = true;
      app.log.debug({ mode, src, reason }, "live relay: closing");
      try {
        client.close();
      } catch {}
      try {
        upstream.close();
      } catch {}
    };

    upstream.on("open", () => {
      app.log.info({ mode, src, queuedMessages: pending.length }, "live relay: upstream open");
      for (const message of pending.splice(0)) {
        upstream.send(message.data, { binary: message.binary });
      }
    });
    upstream.on("message", (data: unknown, isBinary: boolean) => {
      if (client.readyState === 1 && client.bufferedAmount < maxBufferedBytes) {
        client.send(data as any, { binary: isBinary });
      } else if (client.bufferedAmount >= maxBufferedBytes) {
        closeBoth("client_backpressure");
      }
    });
    client.on("message", (data: any, isBinary: boolean) => {
      if (upstream.readyState === 1 && upstream.bufferedAmount < maxBufferedBytes) {
        upstream.send(data, { binary: isBinary });
      }
      else if (upstream.readyState === 0 && pending.length < 32) {
        pending.push({ data, binary: isBinary });
      }
    });
    upstream.on("close", (code: number) => closeBoth(`upstream_close_${code}`));
    upstream.on("error", (error: Error) => {
      app.log.error({ mode, src, upstreamUrl, err: error.message }, "live relay: upstream error");
      closeBoth("upstream_error");
    });
    client.on("close", () => closeBoth("client_close"));
    client.on("error", (error: Error) => {
      app.log.warn({ mode, src, err: error.message }, "live relay: client error");
      closeBoth("client_error");
    });
  };

  app.get("/api/live/:stream/webrtc", { websocket: true }, relay("webrtc"));
  app.get("/api/live/:stream/mse", { websocket: true }, relay("mse"));

  /** Shared streaming proxy (hijacks the reply, aborts on client disconnect). */
  const pipe = createPipe(app);



  /** Proxy a go2rtc HTTP endpoint for a camera, resolving its stream name. */
  const proxyGo2rtc = async (
    camera: string,
    build: (src: string) => string,
    reply: any,
    log: Record<string, unknown>,
    quality: StreamQuality = "high",
  ) => {
    const target = await resolveGo2rtc();
    if (!target) {
      app.log.warn(log, "live http: go2rtc not reachable");
      return reply.code(503).send({ error: "go2rtc_unavailable" });
    }
    const { name, matched } = await resolveStreamSrc(camera, quality);
    if (!matched) {
      app.log.warn({ ...log, tried: name }, "live http: no matching go2rtc stream");
      return reply.code(503).send({ error: "stream_not_configured" });
    }
    const sent = await pipe(`${target.http}${build(encodeURIComponent(name))}`, reply, log);
    return sent ?? reply.code(502).send({ error: "stream_unavailable" });
  };

  // HLS: `index.m3u8` is the playlist; go2rtc's relative segment URIs resolve
  // back into this same route (…/hls/hls/segment.m4s) and pass straight through.
  app.get<{ Params: { stream: string; "*": string } }>(
    "/api/live/:stream/hls/*",
    async (request, reply) => {
      const rest = (request.params as any)["*"] || "";
      const search = request.url.includes("?")
        ? request.url.slice(request.url.indexOf("?") + 1)
        : "";
      const quality = parseQuality((request.query as any)?.q);
      const log = { kind: "hls", stream: request.params.stream, rest, quality };
      if (rest && !rest.endsWith("index.m3u8")) {
        const target = await resolveGo2rtc();
        if (!target) return reply.code(503).send({ error: "go2rtc_unavailable" });
        const sent = await pipe(
          `${target.http}/${rest}${search ? `?${search}` : ""}`,
          reply,
          log,
        );
        return sent ?? reply.code(502).send({ error: "stream_unavailable" });
      }
      return proxyGo2rtc(
        request.params.stream,
        (src) => `/stream.m3u8?src=${src}&mp4`,
        reply,
        log,
        quality,
      );
    },
  );

  // MJPEG: universal last-resort video path — plays in every browser. go2rtc is
  // tried first; when no go2rtc stream exists we use Frigate's own MJPEG feed,
  // which is always available for an enabled camera.
  app.get<{ Params: { stream: string }; Querystring: { fps?: string } }>(
    "/api/live/:stream/mjpeg",
    async (request, reply) => {
      const camera = request.params.stream;
      const quality = parseQuality((request.query as any)?.q);
      const fps = Math.min(Math.max(Number(request.query.fps ?? 5) || 5, 1), 15);
      const log = { kind: "mjpeg", stream: camera };
      const target = await resolveGo2rtc();
      if (target) {
        const { name, matched } = await resolveStreamSrc(camera, quality);
        if (matched) {
          const sent = await pipe(
            `${target.http}/stream.mjpeg?src=${encodeURIComponent(name)}`,
            reply,
            log,
          );
          if (sent) return sent;
        }
      }
      const base = await resolveFrigateBase();
      if (!base) return reply.code(503).send({ error: "frigate_unavailable" });
      const sent = await pipe(
        `${base}/api/${encodeURIComponent(camera)}?fps=${fps}`,
        reply,
        { ...log, via: "frigate-mjpeg" },
      );
      return sent ?? reply.code(502).send({ error: "stream_unavailable" });
    },
  );
}
