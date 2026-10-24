import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { htmlToText, splitParts, writePreloadForAgents } from "../build/preload.ts";

/** @typedef {import("../build/preload.ts").PreloadOptions} PreloadOptions */
/** @typedef {import("../build/preload.ts").PreloadPage} PreloadPage */
/** @typedef {import("../build/preload.ts").PreloadPart} PreloadPart */
/** @typedef {import("../build/preload.ts").PreloadResult} PreloadResult */
/** @typedef {import("node:test").TestContext} TestContext */

/** @type {"https://example.test"} */
const ORIGIN = "https://example.test";

/**
 * A built page with site chrome around its main content.
 * @param {string} title
 * @param {string} main
 * @returns {string}
 */
function builtPage(title, main) {
  return `<!doctype html><html><head><title>${title} | Site</title><meta name="description" content="About ${title}"></head><body><nav>chrome</nav><main id="main">${main}</main><footer>footer</footer><script>window.x=1</script></body></html>`;
}

/**
 * Writes files into a temporary dist/ that the test removes afterwards.
 * @param {TestContext} t
 * @param {Readonly<Record<string, string>>} files
 * @returns {string}
 */
function tempDist(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guiltycodes-preload-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  for (let [file, html] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), html);
  }
  return dir;
}

/**
 * @param {string} dir
 * @param {Partial<PreloadOptions>} [overrides]
 * @returns {PreloadOptions}
 */
function preloadOptions(dir, overrides = {}) {
  return {
    dist: dir,
    origin: ORIGIN,
    name: "Site",
    summary: ["A test site."],
    groupDepth: 2,
    partBudget: 100_000,
    inlineBudget: 60_000,
    ...overrides,
  };
}

test("converts rendered HTML to readable text with exact code and absolute links", () => {
  /** @type {string} */
  const text = htmlToText(
    `<h1 class="pt"><span>Unlock &amp; play</span></h1><table class="kv"><tr><th>Status</th><td><span class="st">VERIFIED</span></td></tr></table>` +
      `<pre class="code">[Code]\npatch=1,EE,0034E922,extended,00000001\n  indented &lt;x&gt;</pre>` +
      `<p>See <a href="../faq/">the FAQ</a> or <code>F233A433</code>.</p><button>Copy</button><label class="sr" for="q">Search</label><input id="q">` +
      `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1|2</td><td>3</td></tr></tbody></table>` +
      `<svg role="img" aria-label="Progress chart"><text>x</text></svg><svg aria-hidden="true"></svg>`,
    ORIGIN,
    "/games/x/code/",
  );
  assert.match(text, /^# Unlock & play$/m);
  assert.match(text, /^Status: VERIFIED$/m);
  assert.match(text, /```\n\[Code\]\npatch=1,EE,0034E922,extended,00000001\n {2}indented <x>\n```/);
  assert.match(text, /\[the FAQ\]\(https:\/\/example\.test\/games\/x\/faq\/\)/);
  assert.match(text, /`F233A433`/);
  assert.match(text, /^\| A \| B \|$/m);
  assert.match(text, /^\| 1\\\|2 \| 3 \|$/m);
  assert.match(text, /\[Image: Progress chart\]/);
  assert.doesNotMatch(text, /Copy|Search|<span|<svg|window/);
});

test("splits large groups at page boundaries and merges small neighbours", () => {
  /** @type {string} */
  const longText = "x".repeat(400);
  /** @type {readonly PreloadPage[]} */
  const pages = [
    { url: "/", title: "Home", description: "", text: "home" },
    { url: "/about/", title: "About", description: "", text: "about" },
    ...Array.from(
      { length: 6 },
      /** @type {(_: unknown, i: number) => PreloadPage} */ (_, i) => ({
        url: `/games/a/${i}/`,
        title: `A ${i}`,
        description: "",
        text: longText,
      }),
    ),
  ];
  /** @type {readonly PreloadPart[]} */
  const parts = splitParts(pages, preloadOptions("", { partBudget: 1200 }));
  assert.equal(parts[0]?.pages.length, 2, "home and about share a part");
  assert.ok(parts.length > 2);
  assert.deepEqual(
    parts.flatMap(
      /** @type {(part: PreloadPart) => string[]} */ (part) =>
        part.pages.map(/** @type {(page: PreloadPage) => string} */ (page) => page.url),
    ),
    pages.map(/** @type {(page: PreloadPage) => string} */ (page) => page.url),
    "every page appears once, in order",
  );
  assert.ok(
    parts.slice(1).every(/** @type {(part: PreloadPart) => boolean} */ (part) => part.text.length <= 1200 + 400 || part.pages.length === 1),
  );
  assert.ok(parts[1]?.title.includes("section 1 of"));
});

test("writes the preload page, text parts and llms.txt from the built pages only", (t) => {
  /** @type {string} */
  const dir = tempDist(t, {
    "index.html": builtPage("Home", "<h1>Home</h1><p>Welcome.</p>"),
    "games/index.html": builtPage("Games", "<h1>Games</h1><pre>CODE 1</pre>"),
    "404.html": builtPage("Not found", "<h1>Missing</h1>"),
    "sitemap.xml": `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/games/</loc></url></urlset>`,
  });
  /** @type {PreloadResult} */
  const result = writePreloadForAgents(preloadOptions(dir));
  assert.equal(result.pages, 2);
  /** @type {string} */
  const html = fs.readFileSync(path.join(dir, "preload-for-agents.html"), "utf8");
  /** @type {string} */
  const all = fs.readFileSync(path.join(dir, "preload-for-agents", "all.txt"), "utf8");
  /** @type {string} */
  const llms = fs.readFileSync(path.join(dir, "llms.txt"), "utf8");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/preload-for-agents">/);
  assert.match(html, /CODE 1/, "small sites inline the full text");
  assert.ok(all.indexOf(`URL: ${ORIGIN}/\n`) < all.indexOf(`URL: ${ORIGIN}/games/\n`), "sitemap order");
  assert.doesNotMatch(all, /Missing|chrome|footer|window\.x/);
  assert.match(llms, /Start here: https:\/\/example\.test\/preload-for-agents/);
});

test("large sites link parts and a page index instead of inlining", (t) => {
  /** @type {Record<string, string>} */
  let files = { "index.html": builtPage("Home", "<h1>Home</h1>") };
  for (let i = 0; i < 4; i++) files[`games/g/${i}/index.html`] = builtPage(`Game ${i}`, `<p>${"y".repeat(500)}</p>`);
  /** @type {string} */
  const dir = tempDist(t, files);
  /** @type {PreloadResult} */
  const result = writePreloadForAgents(preloadOptions(dir, { groupDepth: 3, partBudget: 800, inlineBudget: 1000 }));
  assert.ok(result.parts > 1);
  /** @type {string} */
  const html = fs.readFileSync(path.join(dir, "preload-for-agents.html"), "utf8");
  assert.doesNotMatch(html, /<pre/);
  /** @type {readonly string[]} */
  const partFiles = fs
    .readdirSync(path.join(dir, "preload-for-agents"))
    .filter(/** @type {(file: string) => boolean} */ (file) => file !== "all.txt");
  for (const file of partFiles) {
    assert.match(html, new RegExp(`preload-for-agents/${file}`));
  }
  assert.match(html, /href="https:\/\/example\.test\/games\/g\/3\/"/);
});
