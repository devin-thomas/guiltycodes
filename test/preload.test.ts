import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { htmlToText, splitParts, writePreloadForAgents } from "../build/preload.ts";
import type { PreloadOptions, PreloadPage, PreloadPart, PreloadResult } from "../build/preload.ts";

const ORIGIN: "https://example.test" = "https://example.test";

/** A built page with site chrome around its main content. */
function builtPage(title: string, main: string): string {
  return `<!doctype html><html><head><title>${title} | Site</title><meta name="description" content="About ${title}"></head><body><nav>chrome</nav><main id="main">${main}</main><footer>footer</footer><script>window.x=1</script></body></html>`;
}

/** Writes files into a temporary dist/ that the test removes afterwards. */
function tempDist(context: TestContext, files: Readonly<Record<string, string>>): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), "guiltycodes-preload-"));
  context.after((): void => fs.rmSync(dir, { force: true, recursive: true }));
  for (let [file, html] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), html);
  }
  return dir;
}

function preloadOptions(dir: string, overrides: Partial<PreloadOptions> = {}): PreloadOptions {
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

test("converts rendered HTML to readable text with exact code and absolute links", (): void => {
  const text: string = htmlToText(
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

test("splits large groups at page boundaries and merges small neighbours", (): void => {
  const longText: string = "x".repeat(400);
  const pages: readonly PreloadPage[] = [
    { url: "/", title: "Home", description: "", text: "home" },
    { url: "/about/", title: "About", description: "", text: "about" },
    ...Array.from(
      { length: 6 },
      (_: unknown, i: number): PreloadPage => ({ url: `/games/a/${i}/`, title: `A ${i}`, description: "", text: longText }),
    ),
  ];
  const parts: readonly PreloadPart[] = splitParts(pages, preloadOptions("", { partBudget: 1200 }));
  assert.equal(parts[0]?.pages.length, 2, "home and about share a part");
  assert.ok(parts.length > 2);
  assert.deepEqual(
    parts.flatMap((part: PreloadPart): string[] => part.pages.map((page: PreloadPage): string => page.url)),
    pages.map((page: PreloadPage): string => page.url),
    "every page appears once, in order",
  );
  assert.ok(parts.slice(1).every((part: PreloadPart): boolean => part.text.length <= 1200 + 400 || part.pages.length === 1));
  assert.ok(parts[1]?.title.includes("section 1 of"));
});

test("writes the preload page, text parts and llms.txt from the built pages only", (context: TestContext): void => {
  const dir: string = tempDist(context, {
    "index.html": builtPage("Home", "<h1>Home</h1><p>Welcome.</p>"),
    "games/index.html": builtPage("Games", "<h1>Games</h1><pre>CODE 1</pre>"),
    "404.html": builtPage("Not found", "<h1>Missing</h1>"),
    "sitemap.xml": `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/games/</loc></url></urlset>`,
  });
  const result: PreloadResult = writePreloadForAgents(preloadOptions(dir));
  assert.equal(result.pages, 2);
  const html: string = fs.readFileSync(path.join(dir, "preload-for-agents.html"), "utf8");
  const all: string = fs.readFileSync(path.join(dir, "preload-for-agents", "all.txt"), "utf8");
  const llms: string = fs.readFileSync(path.join(dir, "llms.txt"), "utf8");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/preload-for-agents">/);
  assert.match(html, /CODE 1/, "small sites inline the full text");
  assert.ok(all.indexOf(`URL: ${ORIGIN}/\n`) < all.indexOf(`URL: ${ORIGIN}/games/\n`), "sitemap order");
  assert.doesNotMatch(all, /Missing|chrome|footer|window\.x/);
  assert.match(llms, /Start here: https:\/\/example\.test\/preload-for-agents/);
});

test("large sites link parts and a page index instead of inlining", (context: TestContext): void => {
  let files: Record<string, string> = { "index.html": builtPage("Home", "<h1>Home</h1>") };
  for (let i: number = 0; i < 4; i++) files[`games/g/${i}/index.html`] = builtPage(`Game ${i}`, `<p>${"y".repeat(500)}</p>`);
  const dir: string = tempDist(context, files);
  const result: PreloadResult = writePreloadForAgents(preloadOptions(dir, { groupDepth: 3, partBudget: 800, inlineBudget: 1000 }));
  assert.ok(result.parts > 1);
  const html: string = fs.readFileSync(path.join(dir, "preload-for-agents.html"), "utf8");
  assert.doesNotMatch(html, /<pre/);
  const partFiles: readonly string[] = fs
    .readdirSync(path.join(dir, "preload-for-agents"))
    .filter((file: string): boolean => file !== "all.txt");
  for (const file of partFiles) {
    assert.match(html, new RegExp(`preload-for-agents/${file}`));
  }
  assert.match(html, /href="https:\/\/example\.test\/games\/g\/3\/"/);
});
