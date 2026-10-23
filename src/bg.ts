// Dreamcast background behind the page. Loaded after first paint; the page works without it.
import type { BackgroundHandle } from "@uppercut-labs/dreamcast-backgrounds";
import { createBackground } from "@uppercut-labs/dreamcast-backgrounds";
import scene from "@uppercut-labs/dreamcast-backgrounds/scenes/vector-dojo-showdown";

let handle: BackgroundHandle | null = null;

export function start(el: string): BackgroundHandle {
  if (handle) return handle;
  const still: boolean = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small: boolean = Math.min(innerWidth, innerHeight) < 700;
  handle = createBackground({
    element: el,
    scene,
    motion: still ? "still" : "ambient",
    quality: small ? "low" : "auto",
    camera: "survey",
  });
  return handle;
}

export function stop(): void {
  handle?.dispose();
  handle = null;
}
