import { createFileRoute } from "@tanstack/react-router";

/**
 * Catch-all for /api/* in the Lovable preview.
 *
 * The real Home Assistant add-on serves these paths from its own Fastify
 * backend (modern-frigate-ui/app/backend). The preview has no such backend, so
 * an unmatched /api/* request would otherwise throw and become a 500 HTML error
 * page — which the frontend's one-shot backend probe then has to recover from
 * and which pollutes the runtime error log.
 *
 * Instead, answer every /api/* call with a clean 503 JSON "unavailable"
 * response. The probe sees a non-ok response, switches to demo data, and no 500
 * is ever logged. Non-api routes are unaffected.
 */
const unavailable = () =>
  new Response(JSON.stringify({ available: false, error: "Backend unavailable in preview" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: unavailable,
      POST: unavailable,
      PUT: unavailable,
      DELETE: unavailable,
      PATCH: unavailable,
    },
  },
});
