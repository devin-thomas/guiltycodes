// Guilty Codes build: reads the cheat docs and writes the static site to dist/.
// Usage: RETRO_REPO=/path/to/docs node build.ts   (or: node build.ts --source /path/to/docs)
import type { Code, Download, Release, Site } from "./build/model.ts";
import type { SearchEntry } from "./src/search.ts";
import { requireValue } from "./build/model.ts";
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
  GROUP_ORDER,
  ZIP,
} from "./build/render.ts";
import { scrub, parsePnach } from "./build/lib.ts";
import { writePreloadForAgents } from "./build/preload.ts";
import type { PreloadResult } from "./build/preload.ts";

/** One entry of the committed pnach/index.json that the GitHub release ships. */
type PnachIndexEntry = {
  readonly sha256?: string;
  readonly file: string;
  readonly game: string;
  readonly release: string;
  readonly serial: string;
  readonly crc: string;
  readonly featureId: string | null;
  readonly featurePages: number;
  readonly patchSections: number;
};

const DIST: string = path.resolve("dist");
const ORIGIN: "https://guiltycodes.pages.dev" = "https://guiltycodes.pages.dev";

// Validate all source pins before replacing the previous successful build.
let site: Site = loadSite();
fs.rmSync(DIST, { recursive: true, force: true });
let urls: string[] = [];
function writePage(url: string, html: string): void {
  const file: string = url.endsWith("/") ? path.join(DIST, url, "index.html") : path.join(DIST, url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  if (url.endsWith("/")) urls.push(url);
}

site.built = new Date().toISOString().slice(0, 10);

// Prior-art bullets from the AC+ doc: code title -> sentence crediting lee4.
site.priorMap = new Map();
for (let bullet of site.shared.priorWork.matchAll(/^- (.+(?:\n  .+)*)/gm)) {
  const text: string = requireValue(bullet[1], "prior-work bullet").replace(/\n\s+/g, " ");
  for (let title of text.matchAll(/\*\*([^*]+)\*\*/g)) site.priorMap.set(requireValue(title[1], "prior-work title"), text);
}

// ---- pages ----
writePage("/", homePage(site));
writePage("/games/", gamesIndex(site));
writePage("/how-to/", howToPage(site));
writePage("/credits/", creditsPage(site));
writePage("/search/", searchPage(site));
fs.writeFileSync(path.join(DIST, "404.html"), notFoundPage(site));

let searchEntries: SearchEntry[] = [];
let files: Download[] = [];
for (let game of site.games) {
  writePage(`/games/${game.slug}/`, gamePage(game, site));
  for (let release of game.releases) {
    writePage(release.url, releasePage(release, site));
    if (release.codes.length) writePage(`${release.url}sheet/`, sheetPage(release, site));
    writePage(`${release.url}unlockables/`, unlockPage(release, site));
    writePage(`${release.url}faq/`, faqPage(release, site));
    writePage(`${release.url}tests/`, testsPage(release, site));
    if (release.hasLee4) writePage(`${release.url}prior-art/`, lee4Page(release, site));
    let sorted: Code[] = [...release.codes].sort(
      (left: Code, right: Code): number => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group),
    );
    sorted.forEach((code: Code, i: number): void => {
      writePage(code.url, codePage(code, site, { previous: sorted[i - 1], next: sorted[i + 1] }));
      searchEntries.push({
        t: code.title,
        g: game.title,
        r: `${release.label} ${release.serial}`,
        s: code.status,
        u: code.url,
        x: `${code.title} ${code.effect} ${game.title} ${release.label} ${release.serial} ${release.crc} ${code.raw.join(" ")}`.toLowerCase(),
      });
      if (code.artifact) {
        fs.mkdirSync(path.join(DIST, "pnach"), { recursive: true });
        fs.writeFileSync(path.join(DIST, "pnach", code.artifact.file), code.artifact.text);
        files.push({ ...code.artifact, release, feature: code });
      }
    });
    if (release.pnachText) {
      const clean: string = scrub(release.pnachText).replace(/\s*\(games\/[^)]*\)/g, "");
      fs.mkdirSync(path.join(DIST, "pnach"), { recursive: true });
      const text: string = clean.endsWith("\n") ? clean : clean + "\n";
      fs.writeFileSync(path.join(DIST, "pnach", requireValue(release.pnachFile, "release download filename")), text);
      files.push({
        file: requireValue(release.pnachFile, "release download filename"),
        release,
        text,
        sectionCount: parsePnach(text).sections.length,
      });
    }
  }
}
writePage("/search.json", JSON.stringify(searchEntries));

// ---- downloads: /downloads/, the zip, and the committed pnach/ folder the GitHub release ships ----
files.sort(
  (left: Download, right: Download): number =>
    left.release.game.title.localeCompare(right.release.game.title) || left.file.localeCompare(right.file),
);
writePage("/downloads/", downloadsPage(site, files));
fs.writeFileSync(
  path.join(DIST, "downloads", ZIP),
  zipSync(
    Object.fromEntries(
      files.map((download: Download): [string, Uint8Array<ArrayBufferLike>] => [
        download.file,
        typeof download.text === "string" ? strToU8(download.text) : download.text,
      ]),
    ),
    { mtime: new Date("2000-01-01") },
  ),
);
// Do not replace the committed release artifacts during ordinary builds.
if (process.argv.includes("--write-pnach")) {
  fs.rmSync("pnach", { recursive: true, force: true });
  fs.mkdirSync("pnach");
  for (let download of files) fs.writeFileSync(path.join("pnach", download.file), download.text);
  fs.writeFileSync(
    path.join("pnach", "index.json"),
    JSON.stringify(
      files.map(
        (download: Download): PnachIndexEntry => ({
          file: download.file,
          game: download.release.game.title,
          release: download.release.label,
          serial: download.release.serial,
          crc: download.release.crc,
          featureId: download.feature?.id ?? null,
          featurePages: download.feature ? 1 : download.release.codes.filter((code: Code): boolean => !code.kind).length,
          patchSections: download.sectionCount,
          ...(download.sha256 ? { sha256: download.sha256 } : {}),
        }),
      ),
      null,
      2,
    ) + "\n",
  );
}

// ---- assets ----
const ASSETS: string = path.join(DIST, "assets");
fs.mkdirSync(ASSETS, { recursive: true });
fs.copyFileSync("src/site.css", path.join(ASSETS, "site.css"));

fs.copyFileSync("src/uppercut-labs-logo.png", path.join(ASSETS, "uppercut-labs-logo.png"));
fs.copyFileSync("node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2", path.join(ASSETS, "anton-latin-400-normal.woff2"));
await esbuild({
  entryPoints: ["src/site.ts", "src/bg.ts"],
  bundle: true,
  format: "esm",
  minify: true,
  splitting: true,
  outdir: ASSETS,
  logLevel: "warning",
  legalComments: "none",
});
fs.copyFileSync("node_modules/@uppercut-labs/dreamcast-backgrounds/LICENSE", path.join(ASSETS, "bg.LICENSE.txt"));
fs.copyFileSync("node_modules/@uppercut-labs/dreamcast-backgrounds/NOTICE", path.join(ASSETS, "bg.NOTICE.txt"));
fs.writeFileSync(
  path.join(DIST, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0a0a0f"/><path d="M4 4h24v24H4z" fill="none" stroke="#e8b93c" stroke-width="2"/><path d="M9 25 L21 7 L25 7 L13 25Z" fill="#c4121f"/><path d="M14 25 L26 9" stroke="#fff" stroke-width="1.5"/></svg>`,
);
fs.writeFileSync(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
fs.writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url: string): string => `<url><loc>${ORIGIN}${url}</loc></url>`).join("\n")}\n</urlset>\n`,
);
fs.writeFileSync(
  path.join(DIST, "_headers"),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/assets/*\n  Cache-Control: public, max-age=3600\n/pnach/*\n  Content-Type: text/plain; charset=utf-8\n/preload-for-agents/*\n  Content-Type: text/plain; charset=utf-8\n/llms.txt\n  Content-Type: text/plain; charset=utf-8\n`,
);

// Plain-text mirror of every page for agents and readers without JavaScript; it must run after all pages are written.
const preload: PreloadResult = writePreloadForAgents({
  dist: DIST,
  origin: ORIGIN,
  name: "Guilty Codes",
  summary: [
    "Guilty Codes is a cheat code site for the Guilty Gear PS2 games (X, XX / X2, #Reload, Slash, Accent Core, Accent Core Plus and Isuka), in the style of a pre-2009 cheat site. Every code lists its game release, serial and PCSX2 CRC, raw code, PCSX2 patch text, effect, test result, evidence level and credit.",
    "Status labels: VERIFIED means the effect was seen in a test run on the pinned executable; INFERRED means the same mechanism as a verified code, not run individually; SUPERSEDED marks a code replaced by a corrected version. Downloadable .pnach files are at /downloads/.",
  ],
  groupDepth: 3,
  partBudget: 100_000,
  inlineBudget: 60_000,
});

const featurePages: number = site.releases.reduce((total: number, release: Release): number => total + release.codes.length, 0);
console.log(
  `built ${urls.length} pages, ${featurePages} feature pages, ${files.reduce((total: number, download: Download): number => total + download.sectionCount, 0)} downloadable patch sections, ${site.releases.length} releases, ${preload.parts} agent text parts -> ${DIST}`,
);
