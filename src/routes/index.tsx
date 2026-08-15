import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The production app is the Home Assistant add-on frontend in
// modern-frigate-ui/app/frontend. This route renders those exact components so
// the design can be reviewed here; with no add-on backend reachable, the API
// layer falls back to its demo dataset.
const AppRoot = lazy(async () => ({
  default: (await import("../../modern-frigate-ui/app/frontend/src/app/AppRoot")).AppRoot,
}));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Modern Frigate UI — Mobile NVR for Home Assistant" },
      {
        name: "description",
        content:
          "A mobile-first Frigate NVR frontend for Home Assistant: live camera previews, an NVR scrub timeline and a calm activity feed.",
      },
      { property: "og:title", content: "Modern Frigate UI — Mobile NVR for Home Assistant" },
      {
        property: "og:description",
        content:
          "Beautiful phone-first Frigate viewing: live previews, scrub timeline, detections and per-user preferences, served through Home Assistant Ingress.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div className="min-h-dvh bg-background" />}>
      <Suspense fallback={<div className="min-h-dvh bg-background" />}>
        <AppRoot />
      </Suspense>
    </ClientOnly>
  );
}
