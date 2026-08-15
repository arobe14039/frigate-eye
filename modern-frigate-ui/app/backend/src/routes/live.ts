import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { resolveFrigateBase } from "../services/frigate/client.js";
import { resolveGo2rtc } from "../services/frigate/go2rtc.js";

/**
 * Live streaming adapter. go2rtc (bundled with Frigate) is reached only from
 * this container; the browser talks to relative `api/live/*` paths that work
 * unchanged behind Home Assistant Ingress.
 */
export async function registerLive(app: FastifyInstance) {
  /** Upstream websocket URL for a signalling mode. */
  const upstreamWsUrl = async (mode: "webrtc" | "mse", src: string) => {
    const target = await resolveGo2rtc();
    if (!target) return null;
    const query = `?src=${encodeURIComponent(src)}`;
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

  /** Proxy a go2rtc HTTP endpoint, streaming the body through untouched. */
  const proxyGo2rtc = async (path: string, reply: any, log: Record<string, unknown>) => {
    const target = await resolveGo2rtc();
    if (!target) {
      app.log.warn(log, "live http: go2rtc not reachable");
      return reply.code(503).send({ error: "go2rtc_unavailable" });
    }
    const url = `${target.http}${path}`;
    try {
      const upstream = await fetch(url, { headers: { accept: "*/*" } });
      if (!upstream.ok || !upstream.body) {
        app.log.warn({ ...log, url, status: upstream.status }, "live http: upstream rejected");
        return reply.code(502).send({ error: "stream_unavailable", status: upstream.status });
      }
      reply.header("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
      reply.header("cache-control", "no-store");
      return reply.send(upstream.body);
    } catch (error) {
      app.log.error({ ...log, url, err: (error as Error).message }, "live http: proxy failed");
      return reply.code(503).send({ error: "stream_unavailable" });
    }
  };

  // HLS: `index.m3u8` is the playlist; go2rtc's relative segment URIs resolve
  // back into this same route (…/hls/hls/segment.m4s) and pass straight through.
  app.get<{ Params: { stream: string; "*": string } }>(
    "/api/live/:stream/hls/*",
    async (request, reply) => {
      const rest = (request.params as any)["*"] || "";
      const search = request.url.includes("?") ? request.url.slice(request.url.indexOf("?") + 1) : "";
      const src = encodeURIComponent(request.params.stream);
      const path =
        !rest || rest.endsWith("index.m3u8")
          ? `/stream.m3u8?src=${src}&mp4`
          : `/${rest}${search ? `?${search}` : ""}`;
      return proxyGo2rtc(path, reply, { kind: "hls", stream: request.params.stream, rest });
    },
  );

  // MJPEG: universal last-resort video path — plays in every browser.
  app.get<{ Params: { stream: string } }>("/api/live/:stream/mjpeg", async (request, reply) =>
    proxyGo2rtc(`/stream.mjpeg?src=${encodeURIComponent(request.params.stream)}`, reply, {
      kind: "mjpeg",
      stream: request.params.stream,
    }),
  );
}
