// Dreamcast background behind the page. Loaded after first paint; the page works without it.
import type { BackgroundHandle } from "@uppercut-labs/dreamcast-backgrounds";
import { createBackground } from "@uppercut-labs/dreamcast-backgrounds";
import scene from "@uppercut-labs/dreamcast-backgrounds/scenes/vector-dojo-showdown";

let handle: BackgroundHandle | null = null;

export function startBackground(selector: string): BackgroundHandle {
  if (handle) return handle;
  const prefersStill: boolean = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isSmallViewport: boolean = Math.min(innerWidth, innerHeight) < 700;
  handle = createBackground({
    element: selector,
    scene,
    motion: prefersStill ? "still" : "ambient",
    quality: isSmallViewport ? "low" : "auto",
    camera: "survey",
  });
  return handle;
}

export function stopBackground(): void {
  handle?.dispose();
  handle = null;
}
