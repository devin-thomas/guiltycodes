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
export type PreloadPage = {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly text: string;
};
export type PreloadPart = {
  readonly file: string;
  readonly title: string;
  readonly pages: readonly PreloadPage[];
  readonly text: string;
};
export type PreloadResult = {
  readonly pages: number;
  readonly parts: number;
  readonly chars: number;
};

const PRELOAD_ROUTE: string = "/preload-for-agents";

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

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole: string, name: string): string => {
    if (name[0] === "#") {
      const code: number = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// Block tags inside a link or cell separate words ("Guilty Gear</p><p>1998"); inline tags do not.
function oneLine(html: string): string {
  return decode(
    stripTags(
      html.replace(/<\/?(p|div|h[1-6]|li|ul|ol|section|article|header|footer|figure|figcaption|br|tr|td|th|b|strong|small)\b[^>]*>/gi, " "),
    ),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href: string, origin: string, page: string): string {
  if (/^[a-z]+:/i.test(href)) return href;
  if (href.startsWith("#")) return `${origin}${page}${href}`;
  return new URL(href, `${origin}${page}`).href;
}

// Rows of [th, td] read as "Key: value" lines; anything else becomes a pipe table headed by its first row.
function tableToText(html: string): string {
  let rows: string[][] = [];
  let isKeyValue: boolean = true;
  for (let row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let cells: string[] = [];
    let cellTags: string[] = [];
    for (let cell of (row[1] ?? "").matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      cellTags.push((cell[1] ?? "").toLowerCase());
      cells.push(oneLine(cell[2] ?? "").replace(/\|/g, "\\|"));
    }
    if (!cells.length) continue;
    if (cellTags.length !== 2 || cellTags[0] !== "th" || cellTags[1] !== "td") isKeyValue = false;
    rows.push(cells);
  }
  if (!rows.length) return "";
  if (isKeyValue) return `\n\n${rows.map((row: string[]): string => `${row[0] ?? ""}: ${row[1] ?? ""}`).join("\n")}\n\n`;
  const width: number = Math.max(...rows.map((row: string[]): number => row.length));
  function pipeRow(row: string[]): string {
    return `| ${Array.from({ length: width }, (_: unknown, i: number): string => row[i] ?? "").join(" | ")} |`;
  }
  let head: string[] = rows[0] ?? [];
  let body: string[][] = rows.slice(1);
  return `\n\n${[pipeRow(head), `|${" --- |".repeat(width)}`, ...body.map(pipeRow)].join("\n")}\n\n`;
}

// Converts the HTML our static renderers emit (headings, prose, lists, tables, code) into Markdown-style text.
export function htmlToText(html: string, origin: string, page: string): string {
  let heldBlocks: string[] = [];
  function holdBlock(block: string): string {
    heldBlocks.push(block);
    return `\u0000${heldBlocks.length - 1}\u0000`;
  }
  let text: string = html
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
      holdBlock(`\n\n\`\`\`\n${decode(stripTags(body)).replace(/\n+$/, "")}\n\`\`\`\n\n`),
    )
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_: string, body: string): string => {
      const code: string = oneLine(body);
      return code ? holdBlock(`\`${code}\``) : "";
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_: string, attrs: string, body: string): string => {
      const linkText: string = oneLine(
        body.replace(/\u0000(\d+)\u0000/g, (_match: string, index: string): string => heldBlocks[Number(index)] ?? ""),
      );
      const href: string | undefined = /\bhref="([^"]*)"/i.exec(attrs)?.[1];
      if (!linkText) return "";
      if (!href) return linkText;
      const url: string = absoluteUrl(decode(href), origin, page);
      return holdBlock(url === linkText ? url : `[${linkText}](${url})`);
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_: string, _tag: string, body: string): string => {
      const bold: string = body.trim();
      return bold ? `**${bold}**` : "";
    })
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (whole: string): string =>
      holdBlock(
        tableToText(whole.replace(/\u0000(\d+)\u0000/g, (_match: string, index: string): string => heldBlocks[Number(index)] ?? "")),
      ),
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
  // Adjacent links ("[A](a)[B](b)") read as one run of text without a separator.
  text = text.replace(/(\u0000\d+\u0000)(?=\u0000\d+\u0000)/g, (held: string): string => `${held} `);
  text = decode(stripTags(text));
  text = text
    .split("\n")
    .map((line: string): string => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/^- *$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  // Restore held blocks last so code keeps its exact whitespace.
  for (let i: number = heldBlocks.length - 1; i >= 0; i--) text = text.split(`\u0000${i}\u0000`).join(heldBlocks[i] ?? "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function htmlFiles(dir: string, base: string = dir): string[] {
  let files: string[] = [];
  for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath: string = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...htmlFiles(fullPath, base));
    else if (entry.name.endsWith(".html")) files.push(path.relative(base, fullPath).split(path.sep).join("/"));
  }
  return files;
}

function routeOf(file: string): string {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file.slice(0, -".html".length)}`;
}

function readPages(dist: string, origin: string): PreloadPage[] {
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

function slugOf(key: string): string {
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
  readonly isSplit: boolean;
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
      const isSplit: boolean = pieces.length > 1;
      chunks.push({
        label: isSplit ? `${label}, section ${i + 1} of ${pieces.length}` : label,
        slug: isSplit ? `${slugOf(key)}-${i + 1}` : slugOf(key),
        pages: piece,
        size: piece.reduce((total: number, page: PreloadPage): number => total + pageText(page, options.origin).length, 0),
        isSplit,
      });
    });
  }
  let merged: Chunk[] = [];
  for (let chunk of chunks) {
    const last: Chunk | undefined = merged[merged.length - 1];
    if (last && !chunk.isSplit && !last.isSplit && last.size + chunk.size <= options.partBudget) {
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
      text: header + chunk.pages.map((page: PreloadPage): string => pageText(page, options.origin)).join("\n"),
    };
  });
}

function shortTitle(title: string, name: string): string {
  const suffix: string = ` | ${name}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

function formatSize(chars: number): string {
  return chars < 10_000 ? `${(chars / 1000).toFixed(1)}k characters` : `${Math.round(chars / 1000)}k characters`;
}

function preloadPage(options: PreloadOptions, pages: readonly PreloadPage[], parts: readonly PreloadPart[], all: string): string {
  const base: string = `${options.origin}${PRELOAD_ROUTE}`;
  const isInline: boolean = all.length <= options.inlineBudget;
  const partRows: string = parts
    .map(
      (part: PreloadPart, i: number): string =>
        `<li><a href="${base}/${part.file}">Part ${i + 1}: ${escapeHtml(part.title)}</a> (${part.pages.length} pages, ${formatSize(part.text.length)})</li>`,
    )
    .join("\n");
  const index: string = parts
    .map(
      (part: PreloadPart, i: number): string =>
        `<h3>Part ${i + 1}</h3>\n<ul>\n${part.pages.map((page: PreloadPage): string => `<li><a href="${options.origin}${page.url}">${escapeHtml(page.title)}</a></li>`).join("\n")}\n</ul>`,
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
${options.summary.map((paragraph: string): string => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
<h2>How to read this</h2>
<ul>
<li>This page and the files it links are plain text and HTML with no JavaScript, no sign-in and no GitHub access needed.</li>
<li>They are generated at build time from the site's own public pages, so they say exactly what ${escapeHtml(options.origin)} shows a visitor, and nothing more.</li>
<li>${pages.length} pages, ${formatSize(all.length)} in total.${isInline ? " The full text of every page is included below." : ` Read the parts below in order, or fetch <a href="${base}/all.txt">all.txt</a> (every page in one file) if you can read a file that size.`}</li>
<li>Each page in the text starts with its URL and title. Code blocks are copied exactly.</li>
</ul>
<h2>Full text</h2>
<ul>
<li><a href="${base}/all.txt">Every page in one file</a> (${formatSize(all.length)})</li>
${isInline ? "" : partRows}
</ul>
${isInline ? `<pre style="white-space: pre-wrap">${escapeHtml(all)}</pre>` : `<h2>Page index</h2>\n${index}`}
</main>
</body>
</html>
`;
}

function llmsTxt(options: PreloadOptions, parts: readonly PreloadPart[], all: string): string {
  const base: string = `${options.origin}${PRELOAD_ROUTE}`;
  return `# ${options.name}

> ${options.summary[0] ?? ""}

Start here: ${base} (an agent-readable overview with the full text of the site, no JavaScript needed).

## Full text

- [Every page in one file](${base}/all.txt): ${formatSize(all.length)}
${parts.length > 1 ? parts.map((part: PreloadPart, i: number): string => `- [Part ${i + 1}: ${part.title}](${base}/${part.file}): ${formatSize(part.text.length)}`).join("\n") + "\n" : ""}`;
}

export function writePreloadForAgents(options: PreloadOptions): PreloadResult {
  let pages: PreloadPage[] = readPages(options.dist, options.origin);
  let parts: PreloadPart[] = splitParts(pages, options);
  const all: string = `${options.name}: every page as plain text\nIndex: ${options.origin}${PRELOAD_ROUTE}\nPages: ${pages.length}\n\n${pages.map((page: PreloadPage): string => pageText(page, options.origin)).join("\n")}`;
  const dir: string = path.join(options.dist, PRELOAD_ROUTE.slice(1));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "all.txt"), all);
  if (parts.length > 1) for (let part of parts) fs.writeFileSync(path.join(dir, part.file), part.text);
  fs.writeFileSync(path.join(options.dist, `${PRELOAD_ROUTE.slice(1)}.html`), preloadPage(options, pages, parts, all));
  fs.writeFileSync(path.join(options.dist, "llms.txt"), llmsTxt(options, parts, all));
  return { pages: pages.length, parts: parts.length, chars: all.length };
}
