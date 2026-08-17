import type { FastifyInstance } from "fastify";
import { resolveFrigateBase } from "../services/frigate/client.js";
import { snapToRecording } from "../services/frigate/recordings.js";
import { createPipe } from "../services/httpProxy.js";
import { assertSafeVodPath, cameraParams, epochMs, eventParams } from "../security/validation.js";

/**
 * Recorded (historical) playback.
 *
 * Frigate muxes its recordings into HLS on demand at `/vod/...`, which is far
 * cheaper than an export and needs no transcoding — the stored codec is served
 * as-is. Everything is proxied through this container so the browser never
 * contacts Frigate directly and all URLs stay relative for Ingress.
 *
 * Security: the wildcard tail is NOT concatenated blindly. Camera and event ids
 * are pattern-validated and the tail must match the small set of shapes
 * Frigate's VOD muxer actually serves (playlist, init segment, media segment).
 * This app must never become a general-purpose Frigate reverse proxy.
 */
export async function registerPlayback(app: FastifyInstance) {
  const pipe = createPipe(app);

  const PLAYLIST_CACHE = "no-store";
  /** Segments are immutable, so seeking backwards inside a window costs nothing. */
  const SEGMENT_CACHE = "private, max-age=3600, immutable";

  const isPlaylist = (rest: string) => rest.endsWith(".m3u8");

  /**
   * Nearest recorded moment for a requested instant plus the VOD window to
   * load. The window is what the player keeps buffered; scrubbing inside it is
   * a plain `currentTime` seek with zero extra requests.
   */
  app.get<{ Params: { camera: string }; Querystring: { at?: string; window?: string } }>(
    "/api/playback/:camera/window",
    async (request, reply) => {
      const { camera } = cameraParams.parse(request.params);
      const at =
        request.query.at === undefined || request.query.at === ""
          ? Date.now() - 60_000
          : epochMs.parse(request.query.at);
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
        return reply
          .code(503)
          .send({ error: "FRIGATE_UNAVAILABLE", message: "Frigate is not reachable." });
      }
    },
  );

  /**
   * Camera VOD. The window is expressed as explicit numeric start/end route
   * params so no client-supplied string ever forms part of the upstream path.
   */
  app.get<{ Params: { camera: string; start: string; end: string; "*": string } }>(
    "/api/playback/:camera/vod/start/:start/end/:end/*",
    async (request, reply) => {
      const { camera } = cameraParams.parse(request.params);
      const start = Math.floor(epochMs.parse(Number(request.params.start) * 1000) / 1000);
      const end = Math.floor(epochMs.parse(Number(request.params.end) * 1000) / 1000);
      if (!(start < end)) {
        return reply
          .code(400)
          .send({ error: "INVALID_RANGE", message: "End time must be after start time." });
      }
      const rest = assertSafeVodPath((request.params as any)["*"] || "");
      const base = await resolveFrigateBase();
      if (!base)
        return reply
          .code(503)
          .send({ error: "FRIGATE_UNAVAILABLE", message: "Frigate is not reachable." });
      const sent = await pipe(
        `${base}/vod/${encodeURIComponent(camera)}/start/${start}/end/${end}/${rest}`,
        reply,
        { kind: "vod", camera, rest },
        { cacheControl: isPlaylist(rest) ? PLAYLIST_CACHE : SEGMENT_CACHE },
      );
      return (
        sent ??
        reply
          .code(502)
          .send({ error: "RECORDING_UNAVAILABLE", message: "That recording could not be played." })
      );
    },
  );

  // Event VOD: exact detection clip, muxed by Frigate.
  app.get<{ Params: { id: string; "*": string } }>(
    "/api/playback/event/:id/vod/*",
    async (request, reply) => {
      const { id } = eventParams.parse(request.params);
      const rest = assertSafeVodPath((request.params as any)["*"] || "");
      const base = await resolveFrigateBase();
      if (!base)
        return reply
          .code(503)
          .send({ error: "FRIGATE_UNAVAILABLE", message: "Frigate is not reachable." });
      const sent = await pipe(
        `${base}/vod/event/${encodeURIComponent(id)}/${rest}`,
        reply,
        { kind: "event-vod", id, rest },
        { cacheControl: isPlaylist(rest) ? PLAYLIST_CACHE : SEGMENT_CACHE },
      );
      return (
        sent ??
        reply
          .code(502)
          .send({ error: "RECORDING_UNAVAILABLE", message: "That recording could not be played." })
      );
    },
  );

  /**
   * Single-file event clip. For a short detection this starts faster than HLS,
   * and forwarding `range` keeps in-clip seeking from refetching the file.
   */
  app.get<{ Params: { id: string } }>("/api/playback/event/:id/clip.mp4", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const base = await resolveFrigateBase();
    if (!base)
      return reply
        .code(503)
        .send({ error: "FRIGATE_UNAVAILABLE", message: "Frigate is not reachable." });
    const rawRange = request.headers.range;
    // Only a well-formed byte range is forwarded upstream.
    const range = typeof rawRange === "string" && /^bytes=\d*-\d*$/.test(rawRange) ? rawRange : undefined;
    const sent = await pipe(
      `${base}/api/events/${encodeURIComponent(id)}/clip.mp4`,
      reply,
      { kind: "event-clip", id },
      {
        cacheControl: "private, max-age=600",
        ...(range ? { headers: { range } } : {}),
      },
    );
    return (
      sent ??
      reply.code(502).send({ error: "CLIP_UNAVAILABLE", message: "That clip could not be played." })
    );
  });
}
