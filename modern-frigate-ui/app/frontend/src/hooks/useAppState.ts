import { useEffect, useRef, useState } from "react";
import type { TabKey } from "../types";

/**
 * Hash routing. Ingress mounts the app under an unpredictable prefix, and hash
 * routes survive a refresh on a nested screen without any server rewrite.
 */
export type Route = { tab: TabKey; camera?: string; event?: string };

const parse = (hash: string): Route => {
  const path = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  const [first, second, third, fourth] = path.split("/");
  if (first === "camera" && second) {
    const camera = decodeURIComponent(second);
    return third === "event" && fourth
      ? { tab: "cameras", camera, event: decodeURIComponent(fourth) }
      : { tab: "cameras", camera };
  }
  if (first === "event" && second) return { tab: "activity", event: decodeURIComponent(second) };
  const tabs: TabKey[] = ["home", "activity", "cameras", "settings"];
  return { tab: tabs.includes(first as TabKey) ? (first as TabKey) : "home" };
};

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (next: string) => {
    window.location.hash = next.startsWith("#") ? next : `#/${next.replace(/^\//, "")}`;
  };

  return { route, navigate, back: () => window.history.back() };
}

/** True while the tab/app is actually visible — preview refreshing pauses otherwise. */
export function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/** Viewport awareness so off-screen camera previews never refresh. */
export function useInView<T extends HTMLElement>(rootMargin = "150px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
