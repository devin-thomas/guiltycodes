// /preload-for-agents: the built site's public page text as one no-JS page plus plain-text parts,
// so a web reader that runs no scripts and has no GitHub access can read the whole site from one link.
// It reads only the finished dist/ HTML, so it publishes nothing a visitor cannot already see.
import fs from "node:fs";
import path from "node:path";

export type PreloadOptions = {
  readonly dist: string;
  readonly origin: string;
  readonly name: string;
  readonly summary: readonly string[];
  readonly groupDepth: number;
  readonly partBudget: number;
  readonly inlineBudget: number;
};
export type PreloadPage = { readonly url: string; readonly title: string; readonly description: string; readonly text: string };
export type PreloadPart = { readonly file: string; readonly title: string; readonly pages: readonly PreloadPage[]; readonly text: string };
export type PreloadResult = { readonly pages: number; readonly parts: number; readonly chars: number };

export const PRELOAD_ROUTE: "/preload-for-agents" = "/preload-for-agents";

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  raquo: "»",
  laquo: "«",
  middot: "·",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rarr: "→",
  larr: "←",
  times: "×",
  copy: "©",
};

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole: string, name: string): string => {
    if (name[0] === "#") {
      const code: number = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function oneLine(html: string): string {
  return decode(stripTags(html)).replace(/\s+/g, " ").trim();
}

function absolute(href: string, origin: string, page: string): string {
  if (/^[a-z]+:/i.test(href)) return href;
  if (href.startsWith("#")) return `${origin}${page}${href}`;
  return new URL(href, `${origin}${page}`).href;
}

// Rows of [th, td] read as "Key: value" lines; anything else becomes a pipe table headed by its first row.
function table(html: string): string {
  let rows: string[][] = [];
  let kv: boolean = true;
  for (let row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let cells: string[] = [];
    let kinds: string[] = [];
    for (let cell of (row[1] ?? "").matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      kinds.push((cell[1] ?? "").toLowerCase());
      cells.push(oneLine(cell[2] ?? "").replace(/\|/g, "\\|"));
    }
    if (!cells.length) continue;
    if (kinds.length !== 2 || kinds[0] !== "th" || kinds[1] !== "td") kv = false;
    rows.push(cells);
  }
  if (!rows.length) return "";
  if (kv) return `\n\n${rows.map((r: string[]): string => `${r[0] ?? ""}: ${r[1] ?? ""}`).join("\n")}\n\n`;
  const width: number = Math.max(...rows.map((r: string[]): number => r.length));
  function line(r: string[]): string {
    return `| ${Array.from({ length: width }, (_: unknown, i: number): string => r[i] ?? "").join(" | ")} |`;
  }
  let [head, ...body] = rows;
  return `\n\n${[line(head ?? []), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n")}\n\n`;
}

// Converts the HTML our static renderers emit (headings, prose, lists, tables, code) into Markdown-style text.
export function htmlToText(html: string, origin: string, page: string): string {
  let blocks: string[] = [];
  function hold(text: string): string {
    blocks.push(text);
    return `\u0000${blocks.length - 1}\u0000`;
  }
  let s: string = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|button|select|textarea)\b[\s\S]*?<\/\1>/gi, "")
    // Labels for removed form controls ("Filter codes") are not page content.
    .replace(/<label\b[^>]*\bfor="[^"]*"[^>]*>[\s\S]*?<\/label>/gi, "")
    .replace(/<\/span>/gi, "</span> ")
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi, (_: string, attrs: string): string => {
      const label: string | undefined = /aria-label="([^"]*)"/i.exec(attrs)?.[1];
      return label && !/aria-hidden="true"/i.test(attrs) ? ` [Image: ${decode(label)}] ` : "";
    })
    .replace(/<(input|img)\b[^>]*>/gi, (tag: string): string => {
      const alt: string | undefined = /\balt="([^"]+)"/i.exec(tag)?.[1];
      return alt ? ` [Image: ${decode(alt)}] ` : "";
    })
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_: string, body: string): string =>
      hold(`\n\n\`\`\`\n${decode(stripTags(body)).replace(/\n+$/, "")}\n\`\`\`\n\n`),
    )
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_: string, body: string): string => {
      const text: string = oneLine(body);
      return text ? hold(`\`${text}\``) : "";
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_: string, attrs: string, body: string): string => {
      const text: string = oneLine(body.replace(/\u0000(\d+)\u0000/g, (_m: string, i: string): string => blocks[Number(i)] ?? ""));
      const href: string | undefined = /\bhref="([^"]*)"/i.exec(attrs)?.[1];
      if (!text) return "";
      if (!href) return text;
      const url: string = absolute(decode(href), origin, page);
      return hold(url === text ? url : `[${text}](${url})`);
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_: string, _tag: string, body: string): string => {
      const text: string = body.trim();
      return text ? `**${text}**` : "";
    })
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (whole: string): string =>
      hold(table(whole.replace(/\u0000(\d+)\u0000/g, (_m: string, i: string): string => blocks[Number(i)] ?? ""))),
    )
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_: string, level: string, body: string): string => `\n\n${"#".repeat(Number(level))} ${oneLine(body)}\n\n`,
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_: string, body: string): string => `\n\n**${oneLine(body)}**\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/?(p|div|section|article|aside|header|footer|nav|figure|figcaption|details|ul|ol|dl|dt|dd|main|blockquote|form)\b[^>]*>/gi,
      "\n\n",
    );
  s = decode(stripTags(s));
  s = s
    .split("\n")
    .map((l: string): string => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/^- *$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  // Restore held blocks last so code keeps its exact whitespace.
  for (let i: number = blocks.length - 1; i >= 0; i--) s = s.split(`\u0000${i}\u0000`).join(blocks[i] ?? "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function htmlFiles(dir: string, base: string = dir): string[] {
  let out: string[] = [];
  for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full, base));
    else if (entry.name.endsWith(".html")) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

function routeOf(file: string): string {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file.slice(0, -".html".length)}`;
}

export function readPages(dist: string, origin: string): PreloadPage[] {
  let byUrl: Map<string, string> = new Map();
  for (let file of htmlFiles(dist)) {
    if (file === "404.html" || file === `${PRELOAD_ROUTE.slice(1)}.html`) continue;
    byUrl.set(routeOf(file), file);
  }
  // Sitemap order first (the site's own reading order), then anything the sitemap leaves out.
  let order: string[] = [];
  const sitemap: string = path.join(dist, "sitemap.xml");
  if (fs.existsSync(sitemap)) {
    for (let loc of fs.readFileSync(sitemap, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url: string = decode(loc[1] ?? "").replace(origin, "") || "/";
      if (byUrl.has(url) && !order.includes(url)) order.push(url);
    }
  }
  for (let url of [...byUrl.keys()].sort()) if (!order.includes(url)) order.push(url);
  return order.map((url: string): PreloadPage => {
    const html: string = fs.readFileSync(path.join(dist, byUrl.get(url) ?? ""), "utf8");
    const main: string = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
    return {
      url,
      title: oneLine(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? url),
      description: decode(/<meta name="description" content="([^"]*)"/i.exec(html)?.[1] ?? ""),
      text: htmlToText(main, origin, url),
    };
  });
}

function pageText(page: PreloadPage, origin: string): string {
  let head: string[] = [`URL: ${origin}${page.url}`, `Title: ${page.title}`];
  if (page.description) head.push(`Description: ${page.description}`);
  return `========================================\n${head.join("\n")}\n========================================\n\n${page.text}\n`;
}

function groupKey(url: string, depth: number): string {
  let parts: string[] = url.split("/").filter(Boolean);
  return parts.length ? `/${parts.slice(0, depth).join("/")}/` : "/";
}

function slug(key: string): string {
  return (
    key
      .replace(/^\/|\/$/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase() || "home"
  );
}

type Chunk = {
  readonly label: string;
  readonly slug: string;
  readonly pages: readonly PreloadPage[];
  readonly size: number;
  readonly split: boolean;
};

// Pages grouped by URL prefix; small neighbouring groups share a part, and an oversized group splits at page boundaries.
export function splitParts(pages: readonly PreloadPage[], options: PreloadOptions): PreloadPart[] {
  let groups: Map<string, PreloadPage[]> = new Map();
  for (let page of pages) {
    const key: string = groupKey(page.url, options.groupDepth);
    let group: PreloadPage[] = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }
  let chunks: Chunk[] = [];
  for (let [key, group] of groups) {
    let pieces: PreloadPage[][] = [[]];
    let size: number = 0;
    for (let page of group) {
      const pageSize: number = pageText(page, options.origin).length;
      let current: PreloadPage[] = pieces[pieces.length - 1] ?? [];
      if (current.length && size + pageSize > options.partBudget) {
        pieces.push([page]);
        size = pageSize;
      } else {
        current.push(page);
        size += pageSize;
      }
    }
    const label: string = shortTitle(group[0]?.title ?? key, options.name);
    pieces.forEach((piece: PreloadPage[], i: number): void => {
      const split: boolean = pieces.length > 1;
      chunks.push({
        label: split ? `${label}, section ${i + 1} of ${pieces.length}` : label,
        slug: split ? `${slug(key)}-${i + 1}` : slug(key),
        pages: piece,
        size: piece.reduce((n: number, p: PreloadPage): number => n + pageText(p, options.origin).length, 0),
        split,
      });
    });
  }
  let merged: Chunk[] = [];
  for (let chunk of chunks) {
    const last: Chunk | undefined = merged[merged.length - 1];
    if (last && !chunk.split && !last.split && last.size + chunk.size <= options.partBudget) {
      merged[merged.length - 1] = {
        ...last,
        label: `${last.label}; ${chunk.label}`,
        pages: [...last.pages, ...chunk.pages],
        size: last.size + chunk.size,
      };
    } else merged.push(chunk);
  }
  return merged.map((chunk: Chunk, i: number): PreloadPart => {
    const header: string = `${options.name}: preload for agents, part ${i + 1} of ${merged.length}\n${chunk.label}\nIndex: ${options.origin}${PRELOAD_ROUTE}\nPages in this part: ${chunk.pages.length}\n\n`;
    return {
      file: `${String(i + 1).padStart(2, "0")}-${chunk.slug}.txt`,
      title: chunk.label,
      pages: chunk.pages,
      text: header + chunk.pages.map((p: PreloadPage): string => pageText(p, options.origin)).join("\n"),
    };
  });
}

function shortTitle(title: string, name: string): string {
  const suffix: string = ` | ${name}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

function size(chars: number): string {
  return chars < 10_000 ? `${(chars / 1000).toFixed(1)}k characters` : `${Math.round(chars / 1000)}k characters`;
}

export function preloadPage(options: PreloadOptions, pages: readonly PreloadPage[], parts: readonly PreloadPart[], all: string): string {
  const base: string = `${options.origin}${PRELOAD_ROUTE}`;
  const inline: boolean = all.length <= options.inlineBudget;
  const partRows: string = parts
    .map(
      (p: PreloadPart, i: number): string =>
        `<li><a href="${base}/${p.file}">Part ${i + 1}: ${escapeHtml(p.title)}</a> (${p.pages.length} pages, ${size(p.text.length)})</li>`,
    )
    .join("\n");
  const index: string = parts
    .map(
      (p: PreloadPart, i: number): string =>
        `<h3>Part ${i + 1}</h3>\n<ul>\n${p.pages.map((pg: PreloadPage): string => `<li><a href="${options.origin}${pg.url}">${escapeHtml(pg.title)}</a></li>`).join("\n")}\n</ul>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.name)}: preload for agents</title>
<meta name="description" content="${escapeHtml(`Everything on ${options.name} as plain text for AI agents and readers without JavaScript.`)}">
<link rel="canonical" href="${base}">
<link rel="alternate" type="text/plain" href="${base}/all.txt">
</head>
<body>
<main>
<h1>${escapeHtml(options.name)}: preload for agents</h1>
${options.summary.map((p: string): string => `<p>${escapeHtml(p)}</p>`).join("\n")}
<h2>How to read this</h2>
<ul>
<li>This page and the files it links are plain text and HTML with no JavaScript, no sign-in and no GitHub access needed.</li>
<li>They are generated at build time from the site's own public pages, so they say exactly what ${escapeHtml(options.origin)} shows a visitor, and nothing more.</li>
<li>${pages.length} pages, ${size(all.length)} in total.${inline ? " The full text of every page is included below." : ` Read the parts below in order, or fetch <a href="${base}/all.txt">all.txt</a> (every page in one file) if you can read a file that size.`}</li>
<li>Each page in the text starts with its URL and title. Code blocks are copied exactly.</li>
</ul>
<h2>Full text</h2>
<ul>
<li><a href="${base}/all.txt">Every page in one file</a> (${size(all.length)})</li>
${inline ? "" : partRows}
</ul>
${inline ? `<pre style="white-space: pre-wrap">${escapeHtml(all)}</pre>` : `<h2>Page index</h2>\n${index}`}
</main>
</body>
</html>
`;
}

export function llmsTxt(options: PreloadOptions, parts: readonly PreloadPart[], all: string): string {
  const base: string = `${options.origin}${PRELOAD_ROUTE}`;
  return `# ${options.name}

> ${options.summary[0] ?? ""}

Start here: ${base} (an agent-readable overview with the full text of the site, no JavaScript needed).

## Full text

- [Every page in one file](${base}/all.txt): ${size(all.length)}
${parts.length > 1 ? parts.map((p: PreloadPart, i: number): string => `- [Part ${i + 1}: ${p.title}](${base}/${p.file}): ${size(p.text.length)}`).join("\n") + "\n" : ""}`;
}

export function writePreloadForAgents(options: PreloadOptions): PreloadResult {
  let pages: PreloadPage[] = readPages(options.dist, options.origin);
  let parts: PreloadPart[] = splitParts(pages, options);
  const all: string = `${options.name}: every page as plain text\nIndex: ${options.origin}${PRELOAD_ROUTE}\nPages: ${pages.length}\n\n${pages.map((p: PreloadPage): string => pageText(p, options.origin)).join("\n")}`;
  const dir: string = path.join(options.dist, PRELOAD_ROUTE.slice(1));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "all.txt"), all);
  if (parts.length > 1) for (let p of parts) fs.writeFileSync(path.join(dir, p.file), p.text);
  fs.writeFileSync(path.join(options.dist, `${PRELOAD_ROUTE.slice(1)}.html`), preloadPage(options, pages, parts, all));
  fs.writeFileSync(path.join(options.dist, "llms.txt"), llmsTxt(options, parts, all));
  return { pages: pages.length, parts: parts.length, chars: all.length };
}
