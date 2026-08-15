import { EventEmitter } from "node:events";
import { listEvents } from "./frigate/events.js";
import type { DetectionEvent } from "./frigate/types.js";

/**
 * Realtime detections. Frigate's own event feed is polled by the backend at a
 * calm interval and fanned out to browsers over SSE, so no MQTT credentials or
 * Frigate addresses ever reach the client.
 */
class EventStream extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private lastSeen = 0;
  private subscribers = 0;

  subscribe(onEvent: (event: DetectionEvent) => void) {
    this.subscribers += 1;
    this.on("detection", onEvent);
    this.start();
    return () => {
      this.off("detection", onEvent);
      this.subscribers -= 1;
      if (this.subscribers <= 0) this.stop();
    };
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), 5_000);
    void this.poll();
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll() {
    try {
      const events = await listEvents({ limit: 10 });
      for (const event of events.slice().reverse()) {
        if (event.startTime > this.lastSeen) {
          this.lastSeen = event.startTime;
          this.emit("detection", event);
        }
      }
    } catch {
      /* Frigate offline — stay quiet, health endpoint reports it */
    }
  }
}

export const eventStream = new EventStream();
