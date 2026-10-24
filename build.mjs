// Guilty Codes build: reads the cheat docs and writes the static site to dist/.
// Usage: RETRO_REPO=/path/to/docs node build.mjs   (or: node build.mjs --source /path/to/docs)
import fs from "node:fs";
import path from "node:path";
import { build as esbuild } from "esbuild";
import { zipSync, strToU8 } from "fflate";
import { loadSite } from "./build/data.mjs";
import * as R from "./build/render.mjs";
import { esc, scrub } from "./build/lib.mjs";

const DIST = path.resolve("dist");
const ORIGIN = "https://guiltycodes.pages.dev";
const GROUP_ORDER = ["Everything", "Characters and modes", "EX characters", "Gold, black and SP colours", "Progress", "Stages", "Passwords", "lee4, 2014", "lee4, 2009 (superseded)"];

fs.rmSync(DIST, { recursive: true, force: true });
const urls = [];
const put = (url, html) => {
  const file = url.endsWith("/") ? path.join(DIST, url, "index.html") : path.join(DIST, url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  if (url.endsWith("/")) urls.push(url);
};

const site = loadSite();
site.built = new Date().toISOString().slice(0, 10);

// Prior-art bullets from the AC+ doc: code title -> sentence crediting lee4.
site.priorMap = new Map();
for (const b of site.shared.priorWork.matchAll(/^- (.+(?:\n  .+)*)/gm)) {
  const text = b[1].replace(/\n\s+/g, " ");
  for (const n of text.matchAll(/\*\*([^*]+)\*\*/g)) site.priorMap.set(n[1], text);
}

// Mission Editor (AC+ US): data from data/mission-editor.json (tools/mission-data.py); screenshots from src/mission-shots
// (tools/mission-shots.py, gitignored, so the page shows empty frames when they are absent).
const missionData = JSON.parse(fs.readFileSync("data/mission-editor.json", "utf8"));
const SHOTS = path.resolve("src/mission-shots");
const hasShots = fs.existsSync(SHOTS);
const missionShots = hasShots && fs.existsSync(path.join(SHOTS, "shots.json")) ? JSON.parse(fs.readFileSync(path.join(SHOTS, "shots.json"), "utf8")) : { info: {}, fights: {}, featured: [] };
const missionCtx = { shots: hasShots, ui: missionShots.featured };
for (const r of site.releases) r.hasMissionEditor = r.serial === "SLUS-21847";

// ---- pages ----
put("/", R.homePage(site));
put("/games/", R.gamesIndex(site));
put("/how-to/", R.howToPage(site));
put("/credits/", R.creditsPage(site));
put("/search/", R.searchPage(site));
fs.writeFileSync(path.join(DIST, "404.html"), R.notFoundPage(site));

const search = [];
const files = [];
for (const g of site.games) {
  put(`/games/${g.slug}/`, R.gamePage(g, site));
  for (const r of g.releases) {
    put(r.url, R.releasePage(r, site));
    if (r.codes.length) put(`${r.url}sheet/`, R.sheetPage(r, site));
    put(`${r.url}unlockables/`, R.unlockPage(r, site));
    put(`${r.url}faq/`, R.faqPage(r, site));
    put(`${r.url}tests/`, R.testsPage(r, site));
    if (r.hasLee4) put(`${r.url}prior-art/`, R.lee4Page(r, site));
    if (r.hasMissionEditor) put(`${r.url}mission-editor/`, R.missionPage(r, site, missionCtx));
    const sorted = [...r.codes].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    sorted.forEach((c, i) => {
      put(c.url, R.codePage(c, site, { prev: sorted[i - 1], next: sorted[i + 1] }));
      search.push({ t: c.title, g: g.title, r: `${r.label} ${r.serial}`, s: c.status, u: c.url, x: `${c.title} ${c.effect} ${g.title} ${r.label} ${r.serial} ${r.crc} ${c.raw.join(" ")}`.toLowerCase() });
    });
    if (r.pnachText) {
      const clean = scrub(r.pnachText).replace(/\s*\(games\/[^)]*\)/g, "");
      fs.mkdirSync(path.join(DIST, "pnach"), { recursive: true });
      const text = clean.endsWith("\n") ? clean : clean + "\n";
      fs.writeFileSync(path.join(DIST, "pnach", r.pnachFile), text);
      files.push({ file: r.pnachFile, release: r, text });
    }
  }
}
put("/search.json", JSON.stringify(search));

// ---- downloads: /downloads/, the zip, and the committed pnach/ folder the GitHub release ships ----
files.sort((a, b) => a.release.game.title.localeCompare(b.release.game.title) || a.file.localeCompare(b.file));
put("/downloads/", R.downloadsPage(site, files));
fs.writeFileSync(path.join(DIST, "downloads", R.ZIP), zipSync(Object.fromEntries(files.map((f) => [f.file, strToU8(f.text)])), { mtime: new Date("2000-01-01") }));
fs.rmSync("pnach", { recursive: true, force: true });
fs.mkdirSync("pnach");
for (const f of files) fs.writeFileSync(path.join("pnach", f.file), f.text);
fs.writeFileSync(
  path.join("pnach", "index.json"),
  JSON.stringify(files.map((f) => ({ file: f.file, game: f.release.game.title, release: f.release.label, serial: f.release.serial, crc: f.release.crc, codes: f.release.codes.length })), null, 2) + "\n",
);

// ---- assets ----
const A = path.join(DIST, "assets");
fs.mkdirSync(A, { recursive: true });
fs.copyFileSync("src/site.css", path.join(A, "site.css"));
fs.copyFileSync("src/site.js", path.join(A, "site.js"));
fs.copyFileSync("src/mission-data.js", path.join(A, "mission-data.js"));
fs.copyFileSync("src/mission-editor.js", path.join(A, "mission-editor.js"));
fs.writeFileSync(path.join(A, "mission-stock.js"), `window.MISSION_RAW=${JSON.stringify({ STOCK: missionData.stock, FIELDS: missionData.fields, SCHEMA: missionData.schema })};
`);
fs.writeFileSync(path.join(A, "mission-shots.js"), `window.MISSION_SHOTS=${JSON.stringify({ info: missionShots.info, fights: missionShots.fights })};
`);
if (hasShots) {
  fs.mkdirSync(path.join(A, "missions"), { recursive: true });
  fs.cpSync(SHOTS, path.join(A, "missions"), { recursive: true });
}
fs.copyFileSync("src/uppercut-labs-logo.png", path.join(A, "uppercut-labs-logo.png"));
fs.copyFileSync("node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2", path.join(A, "anton-latin-400-normal.woff2"));
await esbuild({ entryPoints: ["src/bg.js"], bundle: true, format: "esm", minify: true, outfile: path.join(A, "bg.js"), logLevel: "warning", legalComments: "none" });
fs.copyFileSync("node_modules/@uppercut-labs/dreamcast-backgrounds/LICENSE", path.join(A, "bg.LICENSE.txt"));
fs.copyFileSync("node_modules/@uppercut-labs/dreamcast-backgrounds/NOTICE", path.join(A, "bg.NOTICE.txt"));
fs.writeFileSync(
  path.join(DIST, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0a0a0f"/><path d="M4 4h24v24H4z" fill="none" stroke="#e8b93c" stroke-width="2"/><path d="M9 25 L21 7 L25 7 L13 25Z" fill="#c4121f"/><path d="M14 25 L26 9" stroke="#fff" stroke-width="1.5"/></svg>`,
);
fs.writeFileSync(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
fs.writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${ORIGIN}${u}</loc></url>`).join("\n")}\n</urlset>\n`,
);
fs.writeFileSync(
  path.join(DIST, "_headers"),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/assets/*\n  Cache-Control: public, max-age=3600\n/pnach/*\n  Content-Type: text/plain; charset=utf-8\n`,
);

const codes = site.releases.reduce((n, r) => n + r.codes.length, 0);
console.log(`built ${urls.length} pages, ${codes} codes, ${site.releases.length} releases -> ${DIST}`);
