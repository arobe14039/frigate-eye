import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiUrl, backendReachable } from "../services/api";
import type { DetectionEvent } from "../types";

/**
 * Realtime detections arrive from OUR backend over SSE. Frigate/MQTT
 * credentials and addresses stay server-side.
 */
export function useDetectionStream() {
  const queryClient = useQueryClient();
  const [activeCameras, setActiveCameras] = useState<Record<string, number>>({});

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let cancelled = false;

    // Only open the stream once we know a backend is there; otherwise the
    // design preview would retry a failing SSE connection forever.
    void backendReachable().then((reachable) => {
      if (!reachable || cancelled) return;
      try {
        source = new EventSource(apiUrl("api/stream/events"));
      } catch {
        return;
      }
      attach(source);
    });

    const attach = (stream: EventSource) => stream.addEventListener("detection", (message) => {
      try {
        const event = JSON.parse((message as MessageEvent).data) as DetectionEvent;
        setActiveCameras((previous) => ({ ...previous, [event.camera]: Date.now() }));
        queryClient.invalidateQueries({ queryKey: ["events"] });
      } catch {
        /* ignore malformed frame */
      }
    });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [queryClient]);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveCameras((previous) => {
        const next: Record<string, number> = {};
        for (const [camera, at] of Object.entries(previous)) {
          if (Date.now() - at < 30_000) next[camera] = at;
        }
        return next;
      });
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  return { activeCameras };
}
