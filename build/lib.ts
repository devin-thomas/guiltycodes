// Small helpers: markdown slicing, table parsing, pnach parsing, escaping.
import fs from "node:fs";
import { marked } from "marked";

// Extra sanitiser rules for one machine live in docs/sanitize.local.json (ignored by git):
// { "private": ["regex", ...], "replace": [["regex", "replacement"], ...] }
import type { Table, ParsedPnach, PnachSection } from "./model.ts";
import type { Tokens, RendererThis, Renderer } from "marked";
import { requireValue } from "./model.ts";
import { record, list, array } from "./validate.ts";

type LocalRules = { readonly private: readonly string[]; readonly replace: ReadonlyArray<readonly [RegExp, string]> };
function loadLocalRules(): LocalRules {
  let file: URL = new URL("../docs/sanitize.local.json", import.meta.url);
  if (!fs.existsSync(file)) return { private: [], replace: [] };
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  return parseLocalRules(raw);
}

export function parseLocalRules(raw: unknown): LocalRules {
  let value: Record<string, unknown> = record(raw, "sanitize.local.json");
  return {
    private: list(value["private"] ?? [], "private", { unique: false }),
    replace: array(value["replace"] ?? [], "replace").map((item: unknown): readonly [RegExp, string] => {
      const pair: readonly unknown[] = array(item, "replacement");
      if (pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
        throw new Error("Replacement must contain a pattern and replacement string");
      }
      return [new RegExp(pair[0], "g"), pair[1]];
    }),
  };
}
let LOCAL: LocalRules = loadLocalRules();

export function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c: string): string => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

export function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripMd(s: string | undefined): string {
  return String(s ?? "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

/** Text under a heading line (e.g. "## Quick start") up to the next heading of the same or higher level. */
export function section(md: string, heading: string, { required = true }: { readonly required?: boolean } = {}): string {
  let lines: string[] = md.split(/\r?\n/);
  const level: number = requireValue(heading.match(/^#+/), "heading level")[0].length;
  const start: number = lines.findIndex((l: string): boolean => l.trim() === heading.trim());
  if (start < 0) {
    if (required) throw new Error(`section not found: ${heading}`);
    return "";
  }
  let end: number = lines.length;
  for (let i: number = start + 1; i < lines.length; i++) {
    let m: RegExpMatchArray | null = requireValue(lines[i], "heading line").match(/^(#+)\s/);
    if (m && requireValue(m[1], "heading prefix").length <= level) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/** Text between two regexes (start inclusive, end exclusive). */
export function between(
  md: string,
  startRe: RegExp,
  endRe: RegExp | null,
  { required = true }: { readonly required?: boolean } = {},
): string {
  const s: number = md.search(startRe);
  if (s < 0) {
    if (required) throw new Error(`start not found: ${startRe}`);
    return "";
  }
  const rest: string = md.slice(s);
  const e: number = endRe ? rest.slice(1).search(endRe) : -1;
  return (e < 0 ? rest : rest.slice(0, e + 1)).trim();
}

function splitRow(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c: string): string => c.trim().replace(/\\\|/g, "|"));
}

/** All GFM tables in md: { header, rows, text }. */
export function parseTables(md: string): readonly Table[] {
  let lines: string[] = md.split(/\r?\n/);
  let out: Table[] = [];
  for (let i: number = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(requireValue(lines[i], "table line")) && /^\s*\|[\s:|-]+\|\s*$/.test(requireValue(lines[i + 1], "table divider"))) {
      let j: number = i + 2;
      while (j < lines.length && /^\s*\|/.test(requireValue(lines[j], "table row"))) j++;
      out.push({
        header: splitRow(requireValue(lines[i], "table header")),
        rows: lines.slice(i + 2, j).map(splitRow),
        text: lines.slice(i, j).join("\n"),
      });
      i = j;
    }
  }
  return out;
}

/** First table whose header row matches the regex. */
export function tableWith(md: string, headerRe: RegExp): Table {
  const t: Table | undefined = parseTables(md).find((t: Table): boolean => headerRe.test(t.header.join("|")));
  if (!t) throw new Error(`table not found: ${headerRe}`);
  return t;
}

export function tableToMd(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  function row(r: readonly string[]): string {
    return "| " + r.map((c: string): string => String(c).replace(/\|/g, "\\|")).join(" | ") + " |";
  }
  return [row(header), row(header.map((): string => "---")), ...rows.map(row)].join("\n");
}

/** Remove table columns by header name from every table in md. */
export function dropColumns(md: string, names: readonly string[]): string {
  let out: string = md;
  for (const t of parseTables(md)) {
    let idx: number[] = t.header
      .map((h: string, i: number): number => (names.some((n: string): boolean => h.toLowerCase() === n.toLowerCase()) ? i : -1))
      .filter((i: number): boolean => i >= 0);
    if (!idx.length) continue;
    function keep(r: readonly string[]): readonly string[] {
      return r.filter((_: string, i: number): boolean => !idx.includes(i));
    }
    out = out.replace(t.text, tableToMd(keep(t.header), t.rows.map(keep)));
  }
  return out;
}

/** Drop code addresses of routines and jump tables, internal function names and local file mentions. */
export function scrub(s: string | null | undefined): string {
  let out: string = String(s ?? "")
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
  for (let [re, to] of LOCAL.replace) out = out.replace(re, to);
  return out;
}

let PRIVATE: RegExp = new RegExp(
  [
    String.raw`\.py\b`,
    String.raw`[A-Z]:\\`,
    String.raw`\bscripts/`,
    String.raw`\.p2s\b`,
    String.raw`sha256 [0-9a-f]{8}`,
    String.raw`\bevidence\s+\d`,
    ...LOCAL.private,
  ].join("|"),
  "i",
);

/**
 * Make repo-doc markdown fit for a public page: no private paths, scripts, local links or
 * evidence-capture references. Blocks that are about our tooling rather than the codes are dropped.
 */
export function cleanMd(md: string): string {
  let s: string = scrub(dropColumns(md, ["Evidence", "Found from", "Evidence level", "Where it is in SLPS_201.37"]));
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\s*\((?:[^()]*\.py[^()]*|evidence[^()]*|S\d[^()]*evidence[^()]*)\)/gi, "");
  s = s.replace(/\[([^\]]+)\]\((?!https?:|#)[^)]*\)/g, "$1");
  let blocks: string[] = s.split(/\n{2,}/);
  let kept: string[] = [];
  for (const b of blocks) {
    if (/^\s*\|/.test(b)) {
      let rows: string[] = b.split("\n").filter((l: string, i: number): boolean => i < 2 || !PRIVATE.test(l));
      kept.push(rows.join("\n"));
    } else if (b.split("\n").some((l: string): boolean => PRIVATE.test(l)) && !/^\s*[-*]\s/m.test(b)) {
      continue;
    } else if (/^\s*[-*]\s/m.test(b)) {
      let lines: string[] = b.split("\n");
      let out: string[] = [];
      let skip: boolean = false;
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

let renderer: Renderer<string, string> = new marked.Renderer();
renderer.link = function (this: RendererThis, { href, title, tokens }: Tokens.Link): string {
  const text: string = this.parser.parseInline(tokens);
  const ext: boolean = /^https?:/.test(href);
  return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener noreferrer" class="ext"' : ""}>${text}</a>`;
};
renderer.table = function (this: RendererThis, token: Tokens.Table): string {
  const head: string = token.header.map((c: Tokens.TableCell): string => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
  const body: string = token.rows
    .map(
      (r: Tokens.TableCell[]): string =>
        `<tr>${r.map((c: Tokens.TableCell): string => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
};
marked.use({ renderer, gfm: true, breaks: false });

/** Render repo markdown; headings are shifted so the fragment fits under an h2. */
export function md(src: string, { clean = true, shift = 1 }: { readonly clean?: boolean; readonly shift?: number } = {}): string {
  let s: string = clean ? cleanMd(src) : src;
  if (shift) s = s.replace(/^(#{1,5})\s/gm, (_: string, h: string): string => "#".repeat(Math.min(6, h.length + shift)) + " ");
  return marked.parse(s, { async: false });
}
export function mdInline(src: string): string {
  return marked.parseInline(src, { async: false });
}

/** Parse a PCSX2 .pnach: header comments + sections with raw code lines. */
export function parsePnach(text: string): ParsedPnach {
  type SectionBuilder = { name: string; author: string; description: string; patches: string[]; lines: string[] };
  let sections: SectionBuilder[] = [];
  let cur: SectionBuilder | null = null;
  let header: { gametitle: string; comments: string[] } = { gametitle: "", comments: [] };
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpMatchArray | null = line.match(/^\[(.+)\]\s*$/);
    if (m) {
      cur = { name: requireValue(m[1], "pnach section name"), author: "", description: "", patches: [], lines: [line] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      if (line.startsWith("gametitle=")) header.gametitle = line.slice(10);
      else if (line.startsWith("comment=")) header.comments.push(line.slice(8));
      continue;
    }
    if (!line.trim()) continue;
    cur.lines.push(line);
    if (line.startsWith("author=")) cur.author = line.slice(7);
    else if (line.startsWith("description=")) cur.description = line.slice(12);
    else if (line.startsWith("patch=")) cur.patches.push(line);
  }
  return {
    header,
    sections: sections.map(
      (s: SectionBuilder): PnachSection => ({
        name: s.name,
        author: s.author,
        description: s.description,
        patches: s.patches,
        text: s.lines.join("\n"),
        raw: s.patches.map((p: string): string => {
          const f: readonly string[] = p.split(",");
          if (f.length !== 5 || f[1] !== "EE" || f[3] !== "extended") throw new Error(`unexpected patch line: ${p}`);
          return `${f[2]} ${f[4]}`;
        }),
      }),
    ),
  };
}

const REGION_LABELS: Readonly<Record<string, string>> = {
  SLUS: "North America (NTSC-U)",
  SLES: "Europe (PAL)",
  SLPS: "Japan (NTSC-J)",
  SLPM: "Japan (NTSC-J)",
  SLKA: "Korea (NTSC-K)",
};
const REGION_SHORT: Readonly<Record<string, string>> = { SLUS: "US", SLES: "EU", SLPS: "JP", SLPM: "JP", SLKA: "KR" };
export function regionOf(serial: string): string {
  return REGION_LABELS[serial.slice(0, 4)] ?? "Unknown";
}
export function regionShort(serial: string): string {
  return REGION_SHORT[serial.slice(0, 4)] ?? "?";
}
