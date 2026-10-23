import type { CodeGroup } from "./build/model.ts";
import type { Site } from "./build/model.ts";
import type { Code, Download, Release } from "./build/model.ts";
import type { SearchEntry } from "./src/search.ts";
import { requireValue } from "./build/model.ts";
// Guilty Codes build: reads the cheat docs and writes the static site to dist/.
// Usage: RETRO_REPO=/path/to/docs node build.ts   (or: node build.ts --source /path/to/docs)
import fs from "node:fs";
import path from "node:path";
import { build as esbuild } from "esbuild";
import { zipSync, strToU8 } from "fflate";
import { loadSite } from "./build/data.ts";
import {
  homePage,
  gamesIndex,
  howToPage,
  creditsPage,
  searchPage,
  notFoundPage,
  gamePage,
  releasePage,
  sheetPage,
  unlockPage,
  faqPage,
  testsPage,
  lee4Page,
  codePage,
  downloadsPage,
  ZIP,
} from "./build/render.ts";
import { scrub, parsePnach } from "./build/lib.ts";
import { FEATURE_CATEGORIES } from "./build/catalog.ts";

const DIST: string = path.resolve("dist");
const ORIGIN: "https://guiltycodes.pages.dev" = "https://guiltycodes.pages.dev";
const GROUP_ORDER: readonly CodeGroup[] = [
  "Everything",
  "Characters and modes",
  "EX characters",
  "Gold, black and SP colours",
  "Progress",
  "Stages",
  "Passwords",
  "lee4, 2014",
  "lee4, 2009 (superseded)",
  ...FEATURE_CATEGORIES,
];

// Validate all source pins before replacing the previous successful build.
let site: Site = loadSite();
fs.rmSync(DIST, { recursive: true, force: true });
let urls: string[] = [];
function put(url: string, html: string): void {
  const file: string = url.endsWith("/") ? path.join(DIST, url, "index.html") : path.join(DIST, url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  if (url.endsWith("/")) urls.push(url);
}

site.built = new Date().toISOString().slice(0, 10);

// Prior-art bullets from the AC+ doc: code title -> sentence crediting lee4.
site.priorMap = new Map();
for (let b of site.shared.priorWork.matchAll(/^- (.+(?:\n  .+)*)/gm)) {
  const text: string = requireValue(b[1], "prior-work bullet").replace(/\n\s+/g, " ");
  for (let n of text.matchAll(/\*\*([^*]+)\*\*/g)) site.priorMap.set(requireValue(n[1], "prior-work title"), text);
}

// ---- pages ----
put("/", homePage(site));
put("/games/", gamesIndex(site));
put("/how-to/", howToPage(site));
put("/credits/", creditsPage(site));
put("/search/", searchPage(site));
fs.writeFileSync(path.join(DIST, "404.html"), notFoundPage(site));

let search: SearchEntry[] = [];
let files: Download[] = [];
for (let g of site.games) {
  put(`/games/${g.slug}/`, gamePage(g, site));
  for (let r of g.releases) {
    put(r.url, releasePage(r, site));
    if (r.codes.length) put(`${r.url}sheet/`, sheetPage(r, site));
    put(`${r.url}unlockables/`, unlockPage(r, site));
    put(`${r.url}faq/`, faqPage(r, site));
    put(`${r.url}tests/`, testsPage(r, site));
    if (r.hasLee4) put(`${r.url}prior-art/`, lee4Page(r, site));
    let sorted: Code[] = [...r.codes].sort((a: Code, b: Code): number => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    sorted.forEach((c: Code, i: number): void => {
      put(c.url, codePage(c, site, { prev: sorted[i - 1], next: sorted[i + 1] }));
      search.push({
        t: c.title,
        g: g.title,
        r: `${r.label} ${r.serial}`,
        s: c.status,
        u: c.url,
        x: `${c.title} ${c.effect} ${g.title} ${r.label} ${r.serial} ${r.crc} ${c.raw.join(" ")}`.toLowerCase(),
      });
      if (c.artifact) {
        fs.mkdirSync(path.join(DIST, "pnach"), { recursive: true });
        fs.writeFileSync(path.join(DIST, "pnach", c.artifact.file), c.artifact.text);
        files.push({ ...c.artifact, release: r, feature: c });
      }
    });
    if (r.pnachText) {
      const clean: string = scrub(r.pnachText).replace(/\s*\(games\/[^)]*\)/g, "");
      fs.mkdirSync(path.join(DIST, "pnach"), { recursive: true });
      const text: string = clean.endsWith("\n") ? clean : clean + "\n";
      fs.writeFileSync(path.join(DIST, "pnach", requireValue(r.pnachFile, "release download filename")), text);
      files.push({
        file: requireValue(r.pnachFile, "release download filename"),
        release: r,
        text,
        sectionCount: parsePnach(text).sections.length,
      });
    }
  }
}
put("/search.json", JSON.stringify(search));

// ---- downloads: /downloads/, the zip, and the committed pnach/ folder the GitHub release ships ----
files.sort((a: Download, b: Download): number => a.release.game.title.localeCompare(b.release.game.title) || a.file.localeCompare(b.file));
put("/downloads/", downloadsPage(site, files));
fs.writeFileSync(
  path.join(DIST, "downloads", ZIP),
  zipSync(
    Object.fromEntries(
      files.map((f: Download): [string, Uint8Array<ArrayBufferLike>] => [f.file, typeof f.text === "string" ? strToU8(f.text) : f.text]),
    ),
    { mtime: new Date("2000-01-01") },
  ),
);
// Do not replace the committed release artifacts during ordinary builds.
if (process.argv.includes("--write-pnach")) {
  fs.rmSync("pnach", { recursive: true, force: true });
  fs.mkdirSync("pnach");
  for (let f of files) fs.writeFileSync(path.join("pnach", f.file), f.text);
  fs.writeFileSync(
    path.join("pnach", "index.json"),
    JSON.stringify(
      files.map(
        (
          f: Download,
        ): {
          sha256?: string;
          file: string;
          game: string;
          release: string;
          serial: string;
          crc: string;
          featureId: string | null;
          featurePages: number;
          patchSections: number;
        } => ({
          file: f.file,
          game: f.release.game.title,
          release: f.release.label,
          serial: f.release.serial,
          crc: f.release.crc,
          featureId: f.feature?.id ?? null,
          featurePages: f.feature ? 1 : f.release.codes.filter((code: Code): boolean => !code.kind).length,
          patchSections: f.sectionCount,
          ...(f.sha256 ? { sha256: f.sha256 } : {}),
        }),
      ),
      null,
      2,
    ) + "\n",
  );
}

// ---- assets ----
const A: string = path.join(DIST, "assets");
fs.mkdirSync(A, { recursive: true });
fs.copyFileSync("src/site.css", path.join(A, "site.css"));

fs.copyFileSync("src/uppercut-labs-logo.png", path.join(A, "uppercut-labs-logo.png"));
fs.copyFileSync("node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2", path.join(A, "anton-latin-400-normal.woff2"));
await esbuild({
  entryPoints: ["src/site.ts", "src/bg.ts"],
  bundle: true,
  format: "esm",
  minify: true,
  splitting: true,
  outdir: A,
  logLevel: "warning",
  legalComments: "none",
});
fs.copyFileSync("node_modules/@uppercut-labs/dreamcast-backgrounds/LICENSE", path.join(A, "bg.LICENSE.txt"));
fs.copyFileSync("node_modules/@uppercut-labs/dreamcast-backgrounds/NOTICE", path.join(A, "bg.NOTICE.txt"));
fs.writeFileSync(
  path.join(DIST, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0a0a0f"/><path d="M4 4h24v24H4z" fill="none" stroke="#e8b93c" stroke-width="2"/><path d="M9 25 L21 7 L25 7 L13 25Z" fill="#c4121f"/><path d="M14 25 L26 9" stroke="#fff" stroke-width="1.5"/></svg>`,
);
fs.writeFileSync(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
fs.writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u: string): string => `<url><loc>${ORIGIN}${u}</loc></url>`).join("\n")}\n</urlset>\n`,
);
fs.writeFileSync(
  path.join(DIST, "_headers"),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/assets/*\n  Cache-Control: public, max-age=3600\n/pnach/*\n  Content-Type: text/plain; charset=utf-8\n`,
);

const codes: number = site.releases.reduce((n: number, r: Release): number => n + r.codes.length, 0);
console.log(
  `built ${urls.length} pages, ${codes} feature pages, ${files.reduce((n: number, file: Download): number => n + file.sectionCount, 0)} downloadable patch sections, ${site.releases.length} releases -> ${DIST}`,
);
