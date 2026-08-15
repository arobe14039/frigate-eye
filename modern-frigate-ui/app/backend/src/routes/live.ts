import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import WebSocket from "ws";
import { resolveFrigateBase } from "../services/frigate/client.js";
import { resolveGo2rtc, resolveStreamName } from "../services/frigate/go2rtc.js";


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
  const upstreamWsUrl = async (mode: "webrtc" | "mse", camera: string) => {
    const target = await resolveGo2rtc();
    if (!target) return null;
    const { name, matched } = await resolveStreamName(camera);
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
    const client: WebSocket = connection.socket ?? connection;
    const src = String((request.params as any).stream ?? "");
    const upstreamUrl = src ? await upstreamWsUrl(mode, src) : null;
    if (!upstreamUrl) {
      app.log.warn({ mode, src }, "live relay: go2rtc not reachable");
      try {
        client.close(1011, "go2rtc_unavailable");
      } catch {}
      return;
    }

    app.log.info({ mode, src, upstreamUrl }, "live relay: connecting upstream");
    const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 8000 });
    const closeBoth = (reason: string) => {
      app.log.debug({ mode, src, reason }, "live relay: closing");
      try {
        client.close();
      } catch {}
      try {
        upstream.close();
      } catch {}
    };

    upstream.on("open", () => app.log.info({ mode, src }, "live relay: upstream open"));
    upstream.on("message", (data: unknown, isBinary: boolean) => {
      if (client.readyState === 1) client.send(data as any, { binary: isBinary });
    });
    client.on("message", (data: any, isBinary: boolean) => {
      if (upstream.readyState === 1) upstream.send(data, { binary: isBinary });
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

  /**
   * Stream an upstream response body through untouched.
   * The body is a Web ReadableStream, which Fastify cannot send directly —
   * it must be converted to a Node stream, otherwise `reply.send` throws and
   * the caller ends up trying to send a second (already-sent) reply.
   */
  const pipe = async (url: string, reply: any, log: Record<string, unknown>) => {
    try {
      const upstream = await fetch(url, { headers: { accept: "*/*" } });
      if (!upstream.ok || !upstream.body) {
        app.log.warn({ ...log, url, status: upstream.status }, "live http: upstream rejected");
        return null;
      }
      reply.header(
        "content-type",
        upstream.headers.get("content-type") ?? "application/octet-stream",
      );
      reply.header("cache-control", "no-store");
      return reply.send(Readable.fromWeb(upstream.body as any));
    } catch (error) {
      app.log.error({ ...log, url, err: (error as Error).message }, "live http: proxy failed");
      // Never fall through to another send once headers may have gone out.
      if (reply.sent || reply.raw.headersSent) return reply;
      return null;
    }
  };


  /** Proxy a go2rtc HTTP endpoint for a camera, resolving its stream name. */
  const proxyGo2rtc = async (
    camera: string,
    build: (src: string) => string,
    reply: any,
    log: Record<string, unknown>,
  ) => {
    const target = await resolveGo2rtc();
    if (!target) {
      app.log.warn(log, "live http: go2rtc not reachable");
      return reply.code(503).send({ error: "go2rtc_unavailable" });
    }
    const { name, matched } = await resolveStreamName(camera);
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
      const log = { kind: "hls", stream: request.params.stream, rest };
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
      const fps = Math.min(Math.max(Number(request.query.fps ?? 5) || 5, 1), 15);
      const log = { kind: "mjpeg", stream: camera };
      const target = await resolveGo2rtc();
      if (target) {
        const { name, matched } = await resolveStreamName(camera);
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
