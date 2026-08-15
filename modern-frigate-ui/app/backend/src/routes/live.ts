import type { FastifyInstance } from "fastify";
import { resolveFrigateBase } from "../services/frigate/client.js";
import WebSocket from "ws";

/**
 * Live streaming adapter. go2rtc (bundled with Frigate) is reached only from
 * this container; the browser talks to relative `api/live/*` paths that work
 * unchanged behind Home Assistant Ingress.
 */
export async function registerLive(app: FastifyInstance) {
  const relay = (mode: "webrtc" | "mse") => async (connection: any, request: any) => {
    const client: WebSocket = connection.socket ?? connection;
    const base = await resolveFrigateBase();
    const src = String((request.params as any).stream ?? "");
    if (!base || !src) {
      client.close();
      return;
    }
    const upstreamUrl = `${base.replace("http", "ws")}/live/${mode}/api/ws?src=${encodeURIComponent(src)}`;
    const upstream = new WebSocket(upstreamUrl);
    const closeBoth = () => {
      try {
        client.close();
      } catch {}
      try {
        upstream.close();
      } catch {}
    };
    upstream.on("message", (data) => client.readyState === 1 && client.send(data as any));
    client.on("message", (data: any) => upstream.readyState === 1 && upstream.send(data));
    upstream.on("close", closeBoth);
    upstream.on("error", closeBoth);
    client.on("close", closeBoth);
    client.on("error", closeBoth);
  };

  app.get("/api/live/:stream/webrtc", { websocket: true }, relay("webrtc"));
  app.get("/api/live/:stream/mse", { websocket: true }, relay("mse"));

  // HLS fallback, proxied as plain HTTP.
  app.get<{ Params: { stream: string; "*": string } }>(
    "/api/live/:stream/hls/*",
    async (request, reply) => {
      const base = await resolveFrigateBase();
      if (!base) return reply.code(503).send({ error: "frigate_unavailable" });
      const file = (request.params as any)["*"] || "index.m3u8";
      const target = `${base}/live/hls/api/stream.m3u8?src=${encodeURIComponent(request.params.stream)}&mp4=flac`;
      const url = file.endsWith(".m3u8") ? target : `${base}/live/hls/${file}`;
      try {
        const upstream = await fetch(url);
        reply.header("content-type", upstream.headers.get("content-type") ?? "application/vnd.apple.mpegurl");
        reply.header("cache-control", "no-store");
        return reply.send(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        return reply.code(503).send({ error: "stream_unavailable" });
      }
    },
  );
}
