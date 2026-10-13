// Dreamcast background behind the page. Loaded after first paint; the page works without it.
import { createBackground } from "@uppercut-labs/dreamcast-backgrounds";
import scene from "@uppercut-labs/dreamcast-backgrounds/scenes/vector-dojo-showdown";

let handle = null;

export function start(el) {
  if (handle) return handle;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  handle = createBackground({
    element: el,
    scene,
    motion: still ? "still" : "ambient",
    quality: small ? "low" : "auto",
    camera: "survey",
  });
  return handle;
}

export function stop() {
  handle?.dispose();
  handle = null;
}
