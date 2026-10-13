// Small helpers: markdown slicing, table parsing, pnach parsing, escaping.
import fs from "node:fs";
import { marked } from "marked";

// Extra sanitiser rules for one machine live in docs/sanitize.local.json (ignored by git):
// { "private": ["regex", ...], "replace": [["regex", "replacement"], ...] }
const LOCAL = { private: [], replace: [] };
try {
  const j = JSON.parse(fs.readFileSync(new URL("../docs/sanitize.local.json", import.meta.url), "utf8"));
  LOCAL.private = j.private ?? [];
  LOCAL.replace = (j.replace ?? []).map(([re, to]) => [new RegExp(re, "g"), to]);
} catch {}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const stripMd = (s) => String(s ?? "").replace(/\*\*/g, "").replace(/`/g, "").trim();

/** Text under a heading line (e.g. "## Quick start") up to the next heading of the same or higher level. */
export function section(md, heading, { required = true } = {}) {
  const lines = md.split(/\r?\n/);
  const level = heading.match(/^#+/)[0].length;
  const start = lines.findIndex((l) => l.trim() === heading.trim());
  if (start < 0) {
    if (required) throw new Error(`section not found: ${heading}`);
    return "";
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

/** Text between two regexes (start inclusive, end exclusive). */
export function between(md, startRe, endRe, { required = true } = {}) {
  const s = md.search(startRe);
  if (s < 0) {
    if (required) throw new Error(`start not found: ${startRe}`);
    return "";
  }
  const rest = md.slice(s);
  const e = endRe ? rest.slice(1).search(endRe) : -1;
  return (e < 0 ? rest : rest.slice(0, e + 1)).trim();
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** All GFM tables in md: { header, rows, text }. */
export function parseTables(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
      out.push({
        header: splitRow(lines[i]),
        rows: lines.slice(i + 2, j).map(splitRow),
        text: lines.slice(i, j).join("\n"),
      });
      i = j;
    }
  }
  return out;
}

/** First table whose header row matches the regex. */
export function tableWith(md, headerRe) {
  const t = parseTables(md).find((t) => headerRe.test(t.header.join("|")));
  if (!t) throw new Error(`table not found: ${headerRe}`);
  return t;
}

export function tableToMd(header, rows) {
  const row = (r) => "| " + r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ") + " |";
  return [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
}

/** Remove table columns by header name from every table in md. */
export function dropColumns(md, names) {
  let out = md;
  for (const t of parseTables(md)) {
    const idx = t.header.map((h, i) => (names.some((n) => h.toLowerCase() === n.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const keep = (r) => r.filter((_, i) => !idx.includes(i));
    out = out.replace(t.text, tableToMd(keep(t.header), t.rows.map(keep)));
  }
  return out;
}

/** Drop code addresses of routines and jump tables, internal function names and local file mentions. */
export function scrub(s) {
  let out = String(s ?? "")
    .replace(/,\s*(?:the game's own debug "all open" routine )?\(0x[0-9A-F]{6}, reachable/g, " (reachable")
    .replace(/\(0x[0-9A-F]{6}, reachable/g, "(reachable")
    .replace(/\s*\((?:the )?(?:jump tables? )?0x[0-9A-F]{6}[^()]*\)/g, "")
    .replace(/,\s*jump tables? 0x[0-9A-F]{6}/g, "")
    .replace(/\s*\(`?TotalTime_SetFlag`?[^()]*\)/g, "")
    .replace(/\s*\(screenshot `[^`]*`\)/g, "")
    .replace(/\s*\([^()]*\.py\)/g, "")
    .replace(/\s*\(games\/[^()]*\)/g, "")
    .replace(/ from games\/[a-z0-9-]+/g, "")
    .replace(/(\S)\s+\.(?=\s|$)/g, "$1.");
  for (const [re, to] of LOCAL.replace) out = out.replace(re, to);
  return out;
}

const PRIVATE = new RegExp(
  [String.raw`\.py\b`, String.raw`[A-Z]:\\`, String.raw`\bscripts/`, String.raw`\.p2s\b`, String.raw`sha256 [0-9a-f]{8}`, String.raw`\bevidence\s+\d`, ...LOCAL.private].join("|"),
  "i",
);

/**
 * Make repo-doc markdown fit for a public page: no private paths, scripts, local links or
 * evidence-capture references. Blocks that are about our tooling rather than the codes are dropped.
 */
export function cleanMd(md) {
  let s = scrub(dropColumns(md, ["Evidence", "Found from", "Evidence level", "Where it is in SLPS_201.37"]));
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\s*\((?:[^()]*\.py[^()]*|evidence[^()]*|S\d[^()]*evidence[^()]*)\)/gi, "");
  s = s.replace(/\[([^\]]+)\]\((?!https?:|#)[^)]*\)/g, "$1");
  const blocks = s.split(/\n{2,}/);
  const kept = [];
  for (const b of blocks) {
    if (/^\s*\|/.test(b)) {
      const rows = b.split("\n").filter((l, i) => i < 2 || !PRIVATE.test(l));
      kept.push(rows.join("\n"));
    } else if (b.split("\n").some((l) => PRIVATE.test(l)) && !/^\s*[-*]\s/m.test(b)) {
      continue;
    } else if (/^\s*[-*]\s/m.test(b)) {
      const lines = b.split("\n");
      const out = [];
      let skip = false;
      for (const l of lines) {
        if (/^\s*[-*]\s/.test(l)) skip = PRIVATE.test(l);
        else if (PRIVATE.test(l)) skip = true;
        if (!skip) out.push(l);
      }
      if (out.length) kept.push(out.join("\n"));
    } else kept.push(b);
  }
  return kept.join("\n\n").trim();
}

const renderer = new marked.Renderer();
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const ext = /^https?:/.test(href);
  return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener noreferrer" class="ext"' : ""}>${text}</a>`;
};
renderer.table = function (token) {
  const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
  const body = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
};
marked.use({ renderer, gfm: true, breaks: false });

/** Render repo markdown; headings are shifted so the fragment fits under an h2. */
export function md(src, { clean = true, shift = 1 } = {}) {
  let s = clean ? cleanMd(src) : src;
  if (shift) s = s.replace(/^(#{1,5})\s/gm, (_, h) => "#".repeat(Math.min(6, h.length + shift)) + " ");
  return marked.parse(s);
}
export const mdInline = (src) => marked.parseInline(src);

/** Parse a PCSX2 .pnach: header comments + sections with raw code lines. */
export function parsePnach(text) {
  const sections = [];
  let cur = null;
  const header = { gametitle: "", comments: [] };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\[(.+)\]\s*$/);
    if (m) {
      cur = { name: m[1], author: "", description: "", patches: [], text: [line] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      if (line.startsWith("gametitle=")) header.gametitle = line.slice(10);
      else if (line.startsWith("comment=")) header.comments.push(line.slice(8));
      continue;
    }
    if (!line.trim()) continue;
    cur.text.push(line);
    if (line.startsWith("author=")) cur.author = line.slice(7);
    else if (line.startsWith("description=")) cur.description = line.slice(12);
    else if (line.startsWith("patch=")) cur.patches.push(line);
  }
  for (const s of sections) {
    s.raw = s.patches.map((p) => {
      const f = p.split(",");
      if (f.length !== 5 || f[1] !== "EE" || f[3] !== "extended") throw new Error(`unexpected patch line: ${p}`);
      return `${f[2]} ${f[4]}`;
    });
    s.text = s.text.join("\n");
  }
  return { header, sections };
}

export const regionOf = (serial) =>
  ({ SLUS: "North America (NTSC-U)", SLES: "Europe (PAL)", SLPS: "Japan (NTSC-J)", SLPM: "Japan (NTSC-J)", SLKA: "Korea (NTSC-K)" })[serial.slice(0, 4)] ?? "Unknown";
export const regionShort = (serial) => ({ SLUS: "US", SLES: "EU", SLPS: "JP", SLPM: "JP", SLKA: "KR" })[serial.slice(0, 4)] ?? "?";
