import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getCamera, listCameras, listLabels, getFrigateStats } from "../services/frigate/cameras.js";
import { frigateMeta, resolveFrigateBase, frigateFetch } from "../services/frigate/client.js";
import {
  buildGo2rtcSuggestion,
  go2rtcDiagnostics,
  resolveStreamName,
} from "../services/frigate/go2rtc.js";
import { getEvent, listEvents } from "../services/frigate/events.js";
import { requestExport } from "../services/frigate/exports.js";
import { streamOptions } from "../services/frigate/live.js";
import { cameraPreview, eventSnapshot, eventThumbnail, recordingFrame } from "../services/frigate/media.js";
import { getTimeline } from "../services/frigate/recordings.js";
import { eventStream } from "../services/eventStream.js";
import { haStatus, resolveUserId, resolveUserName } from "../services/homeAssistantService.js";
import { getPreferences, preferencesSchema, savePreferences } from "../services/preferences.js";

const csvList = (value: unknown) =>
  typeof value === "string" && value.length ? value.split(",").filter(Boolean) : undefined;

const eventQuery = z.object({
  cameras: z.string().optional(),
  labels: z.string().optional(),
  zones: z.string().optional(),
  after: z.coerce.number().optional(),
  before: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

export async function registerApi(app: FastifyInstance) {
  const sendImage = async (
    reply: any,
    loader: () => Promise<{ body: Buffer; contentType: string; cacheControl: string }>,
  ) => {
    try {
      const image = await loader();
      reply.header("content-type", image.contentType);
      reply.header("cache-control", image.cacheControl);
      return reply.send(image.body);
    } catch {
      return reply.code(503).send({ error: "unavailable" });
    }
  };

  app.get("/api/health", async () => ({ status: "ok", version: config.version }));

  /** Frigate reports its version as plain text, not JSON. */
  const frigateVersion = async () =>
    frigateFetch("/api/version")
      .then((res) => res.text())
      .then((text) => text.replace(/["\s]/g, "") || undefined)
      .catch(() => undefined);

  /** Total detection fps across detectors, with a top-level stats fallback. */
  const detectionFps = (stats: any): number | undefined => {
    if (!stats) return undefined;
    const detectors = Object.values<any>(stats.detectors ?? {});
    const summed = detectors.reduce((sum, d) => sum + Number(d?.detection_fps ?? 0), 0);
    if (summed > 0) return summed;
    const cameras = Object.values<any>(stats.cameras ?? {});
    const cameraSum = cameras.reduce((sum, c) => sum + Number(c?.detection_fps ?? 0), 0);
    if (cameraSum > 0) return cameraSum;
    const top = Number(stats.detection_fps ?? 0);
    return top > 0 ? top : undefined;
  };

  app.get("/api/status", async () => {
    const base = await resolveFrigateBase();
    const meta = frigateMeta();
    let version: string | undefined;
    let cameraCount: number | undefined;
    let detectorFps: number | undefined;

    if (base) {
      version = await frigateVersion();
      const cameras = await listCameras().catch(() => []);
      cameraCount = cameras.length;
      detectorFps = detectionFps(await getFrigateStats().catch(() => null));
    }

    return {
      app: { version: config.version, previewRefreshSeconds: config.previewRefreshSeconds },
      frigate: {
        connected: Boolean(base),
        version,
        cameraCount,
        detectorFps,
        discoveredVia: meta.via,
        error: base ? undefined : (meta.lastError ?? undefined),
      },
      homeAssistant: await haStatus(),
    };
  });

  /**
   * Port + stream health for the Settings screen: which internal ports answer,
   * how go2rtc is reached, and whether each camera maps to a go2rtc stream.
   */
  app.get("/api/diagnostics", async () => {
    const go2rtc = await go2rtcDiagnostics();
    const cameras = await listCameras().catch(() => []);
    const streams = await Promise.all(
      cameras.map(async (camera) => {
        const resolved = await resolveStreamName(camera.id);
        return { camera: camera.id, streamName: resolved.name, matched: resolved.matched };
      }),
    );
    return {
      ports: [
        {
          label: "Frigate API",
          port: go2rtc.frigatePort,
          required: true,
          ok: go2rtc.frigateReachable,
          detail: go2rtc.frigateBase ?? "No reachable Frigate instance",
        },
        {
          label: "go2rtc (live video)",
          port: go2rtc.go2rtcPort,
          required: false,
          ok: go2rtc.go2rtcDirect,
          detail: go2rtc.go2rtcDirect
            ? "Direct connection working"
            : "Port closed — enable it in the Frigate add-on network options for WebRTC/MSE",
        },
      ],
      liveVia: go2rtc.via,
      streamCount: go2rtc.streamCount,
      go2rtcStreams: go2rtc.streams,
      cameraStreams: streams,
      go2rtcSuggestion: await buildGo2rtcSuggestion(
        streams.filter((entry) => !entry.matched).map((entry) => entry.camera),
      ),
    };
  });


  app.post("/api/status/test", async () => {
    const base = await resolveFrigateBase(true);
    return { connected: Boolean(base), via: frigateMeta().via, error: frigateMeta().lastError };
  });

  app.get("/api/session", async (request) => ({
    userName: resolveUserName(request.headers as Record<string, unknown>),
    preferences: await getPreferences(resolveUserId(request.headers as Record<string, unknown>)),
  }));

  app.put("/api/preferences", async (request, reply) => {
    const parsed = preferencesSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid preferences" });
    return savePreferences(resolveUserId(request.headers as Record<string, unknown>), parsed.data);
  });

  app.get("/api/cameras", async (_request, reply) => {
    try {
      return await listCameras();
    } catch {
      return reply.code(503).send({ error: "frigate_unavailable" });
    }
  });

  app.get<{ Params: { camera: string } }>("/api/cameras/:camera", async (request, reply) => {
    const camera = await getCamera(request.params.camera).catch(() => null);
    if (!camera) return reply.code(404).send({ error: "not_found" });
    return { ...camera, streams: await streamOptions(camera.id) };
  });

  app.get<{ Params: { camera: string }; Querystring: { h?: string } }>(
    "/api/cameras/:camera/preview",
    (request, reply) =>
      sendImage(reply, () =>
        cameraPreview(request.params.camera, Math.min(Number(request.query.h ?? 360) || 360, 720)),
      ),
  );

  app.get("/api/labels", async (_request, reply) => {
    try {
      return await listLabels();
    } catch {
      return reply.code(503).send({ error: "frigate_unavailable" });
    }
  });

  app.get("/api/events", async (request, reply) => {
    const parsed = eventQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query" });
    const q = parsed.data;
    try {
      return await listEvents({
        cameras: csvList(q.cameras),
        labels: csvList(q.labels),
        zones: csvList(q.zones),
        after: q.after,
        before: q.before,
        limit: q.limit,
      });
    } catch {
      return reply.code(503).send({ error: "frigate_unavailable" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/events/:id", async (request, reply) => {
    const event = await getEvent(request.params.id);
    if (!event) return reply.code(404).send({ error: "not_found" });
    return event;
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/thumbnail", (request, reply) =>
    sendImage(reply, () => eventThumbnail(request.params.id)),
  );

  app.get<{ Params: { id: string } }>("/api/events/:id/snapshot", (request, reply) =>
    sendImage(reply, () => eventSnapshot(request.params.id)),
  );

  app.get<{ Params: { camera: string }; Querystring: { after?: string; before?: string } }>(
    "/api/timeline/:camera",
    async (request, reply) => {
      const before = Number(request.query.before) || Date.now();
      const after = Number(request.query.after) || before - 60 * 60 * 1000;
      try {
        return await getTimeline(request.params.camera, after, before);
      } catch {
        return reply.code(503).send({ error: "frigate_unavailable" });
      }
    },
  );

  app.get<{ Params: { camera: string }; Querystring: { after?: string; before?: string } }>(
    "/api/recordings/:camera",
    async (request, reply) => {
      const before = Number(request.query.before) || Date.now();
      const after = Number(request.query.after) || before - 60 * 60 * 1000;
      try {
        return (await getTimeline(request.params.camera, after, before)).segments;
      } catch {
        return reply.code(503).send({ error: "frigate_unavailable" });
      }
    },
  );

  app.get<{ Params: { camera: string; ts: string } }>(
    "/api/recordings/:camera/frame/:ts",
    (request, reply) =>
      sendImage(reply, () => recordingFrame(request.params.camera, Number(request.params.ts))),
  );

  app.post<{ Body: unknown }>("/api/exports", async (request, reply) => {
    const parsed = z
      .object({ camera: z.string().min(1), start: z.number(), end: z.number() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    try {
      return await requestExport(parsed.data.camera, parsed.data.start, parsed.data.end);
    } catch {
      return reply.code(503).send({ error: "frigate_unavailable" });
    }
  });

  // Server-Sent Events: realtime detections for the frontend.
  app.get("/api/stream/events", (request, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`: connected\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    const unsubscribe = eventStream.subscribe((event) => {
      reply.raw.write(`event: detection\ndata: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
