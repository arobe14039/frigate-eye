import type { FastifyInstance } from "fastify";
import { resolveFrigateBase } from "../services/frigate/client.js";
import { snapToRecording } from "../services/frigate/recordings.js";
import { createPipe } from "../services/httpProxy.js";

/**
 * Recorded (historical) playback.
 *
 * Frigate muxes its recordings into HLS on demand at `/vod/...`, which is far
 * cheaper than an export and needs no transcoding — the stored codec is served
 * as-is. Everything is proxied through this container so the browser never
 * contacts Frigate directly and all URLs stay relative for Ingress.
 */
export async function registerPlayback(app: FastifyInstance) {
  const pipe = createPipe(app);

  const PLAYLIST_CACHE = "no-store";
  /** Segments are immutable, so seeking backwards inside a window costs nothing. */
  const SEGMENT_CACHE = "private, max-age=3600, immutable";

  const isPlaylist = (rest: string) => rest.endsWith(".m3u8") || rest === "";

  /**
   * Nearest recorded moment for a requested instant plus the VOD window to
   * load. The window is what the player keeps buffered; scrubbing inside it is
   * a plain `currentTime` seek with zero extra requests.
   */
  app.get<{ Params: { camera: string }; Querystring: { at?: string; window?: string } }>(
    "/api/playback/:camera/window",
    async (request, reply) => {
      const camera = request.params.camera;
      const at = Number(request.query.at) || Date.now() - 60_000;
      const requested = Math.min(Math.max(Number(request.query.window) || 300_000, 60_000), 3_600_000);
      try {
        const snapped = await snapToRecording(camera, at);
        const half = requested / 2;
        const start = Math.max(
          snapped.segment ? snapped.segment.startTime : snapped.time - half,
          snapped.time - half,
        );
        const end = Math.min(
          snapped.segment ? snapped.segment.endTime : snapped.time + half,
          Math.min(snapped.time + half, Date.now()),
        );
        const startSeconds = Math.floor(start / 1000);
        const endSeconds = Math.max(Math.ceil(end / 1000), startSeconds + 5);
        return {
          camera,
          available: snapped.available,
          time: snapped.time,
          start: startSeconds * 1000,
          end: endSeconds * 1000,
          playlist: `api/playback/${encodeURIComponent(camera)}/vod/start/${startSeconds}/end/${endSeconds}/index.m3u8`,
        };
      } catch {
        return reply.code(503).send({ error: "frigate_unavailable" });
      }
    },
  );

  // Camera VOD: playlist and segments. go2rtc is not involved — this is
  // Frigate's own recording muxer.
  app.get<{ Params: { camera: string; "*": string } }>(
    "/api/playback/:camera/vod/*",
    async (request, reply) => {
      const base = await resolveFrigateBase();
      if (!base) return reply.code(503).send({ error: "frigate_unavailable" });
      const rest = (request.params as any)["*"] || "";
      const camera = request.params.camera;
      const sent = await pipe(
        `${base}/vod/${encodeURIComponent(camera)}/${rest}`,
        reply,
        { kind: "vod", camera, rest },
        { cacheControl: isPlaylist(rest) ? PLAYLIST_CACHE : SEGMENT_CACHE },
      );
      return sent ?? reply.code(502).send({ error: "recording_unavailable" });
    },
  );

  // Event VOD: exact detection clip, muxed by Frigate.
  app.get<{ Params: { id: string; "*": string } }>(
    "/api/playback/event/:id/vod/*",
    async (request, reply) => {
      const base = await resolveFrigateBase();
      if (!base) return reply.code(503).send({ error: "frigate_unavailable" });
      const rest = (request.params as any)["*"] || "";
      const id = request.params.id;
      const sent = await pipe(
        `${base}/vod/event/${encodeURIComponent(id)}/${rest}`,
        reply,
        { kind: "event-vod", id, rest },
        { cacheControl: isPlaylist(rest) ? PLAYLIST_CACHE : SEGMENT_CACHE },
      );
      return sent ?? reply.code(502).send({ error: "recording_unavailable" });
    },
  );

  /**
   * Single-file event clip. For a short detection this starts faster than HLS,
   * and forwarding `range` keeps in-clip seeking from refetching the file.
   */
  app.get<{ Params: { id: string } }>("/api/playback/event/:id/clip.mp4", async (request, reply) => {
    const base = await resolveFrigateBase();
    if (!base) return reply.code(503).send({ error: "frigate_unavailable" });
    const range = request.headers.range;
    const sent = await pipe(
      `${base}/api/events/${encodeURIComponent(request.params.id)}/clip.mp4`,
      reply,
      { kind: "event-clip", id: request.params.id, range },
      {
        cacheControl: "private, max-age=600",
        ...(range ? { headers: { range } } : {}),
      },
    );
    return sent ?? reply.code(502).send({ error: "clip_unavailable" });
  });
}
