import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { registerApi } from "./routes/api.js";
import { registerLive } from "./routes/live.js";
import { registerPlayback } from "./routes/playback.js";
import { resolveFrigateBase } from "./services/frigate/client.js";

const app = Fastify({ logger: { level: config.logLevel as any }, trustProxy: true });

// Ingress and some clients send POSTs without a usable content-type; accept
// those instead of answering 415.
app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body: Buffer, done) => {
  const raw = body.toString("utf8").trim();
  if (!raw) return done(null, undefined);
  try {
    done(null, JSON.parse(raw));
  } catch {
    done(null, raw);
  }
});

await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024 } });
await registerApi(app);
await registerLive(app);
await registerPlayback(app);

// Supervisor watchdog target — must answer even when Frigate is down.
app.get("/health", async () => ({ status: "ok", version: config.version }));

const staticRoot = resolve(config.staticDir);
if (existsSync(staticRoot)) {
  await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
  // SPA fallback: any non-API path serves the shell so nested URLs survive refresh.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile("index.html");
  });
}

void resolveFrigateBase().then((base) => {
  app.log.info(base ? "Frigate discovered on the internal network" : "Frigate not reachable yet");
});

await app.listen({ port: config.port, host: config.host });
