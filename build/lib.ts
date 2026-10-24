// Small helpers: markdown slicing, table parsing, pnach parsing, escaping.
import fs from "node:fs";
import { marked } from "marked";
import type { Tokens, RendererThis, Renderer } from "marked";
import type { Table, ParsedPnach, PnachSection } from "./model.ts";
import { requireValue } from "./model.ts";
import { parseRecord, parseTextList, parseArray } from "./validate.ts";

// Extra sanitiser rules for one machine live in docs/sanitize.local.json (ignored by git):
// { "private": ["regex", ...], "replace": [["regex", "replacement"], ...] }
export type LocalRules = { readonly private: readonly string[]; readonly replace: ReadonlyArray<readonly [RegExp, string]> };

function loadLocalRules(): LocalRules {
  let file: URL = new URL("../docs/sanitize.local.json", import.meta.url);
  if (!fs.existsSync(file)) return { private: [], replace: [] };
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  return parseLocalRules(raw);
}

export function parseLocalRules(raw: unknown): LocalRules {
  let rules: Record<string, unknown> = parseRecord(raw, "sanitize.local.json");
  return {
    private: parseTextList(rules["private"] ?? [], "private", { unique: false }),
    replace: parseArray(rules["replace"] ?? [], "replace").map((item: unknown): readonly [RegExp, string] => {
      const pair: readonly unknown[] = parseArray(item, "replacement");
      if (pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
        throw new Error("Replacement must contain a pattern and replacement string");
      }
      return [new RegExp(pair[0], "g"), pair[1]];
    }),
  };
}
let localRules: LocalRules = loadLocalRules();

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, (character: string): string => {
    switch (character) {
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
        return character;
    }
  });
}

export function slugify(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripMarkdown(markdown: string | undefined): string {
  return String(markdown ?? "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

type RequiredOption = { readonly required?: boolean };

/** Text under a heading line (e.g. "## Quick start") up to the next heading of the same or higher level. */
export function sectionBody(markdown: string, heading: string, { required = true }: RequiredOption = {}): string {
  let lines: string[] = markdown.split(/\r?\n/);
  const headingLevel: number = requireValue(heading.match(/^#+/), "heading level")[0].length;
  const start: number = lines.findIndex((line: string): boolean => line.trim() === heading.trim());
  if (start < 0) {
    if (required) throw new Error(`section not found: ${heading}`);
    return "";
  }
  let end: number = lines.length;
  for (let i: number = start + 1; i < lines.length; i++) {
    let headingMatch: RegExpMatchArray | null = requireValue(lines[i], "heading line").match(/^(#+)\s/);
    if (headingMatch && requireValue(headingMatch[1], "heading prefix").length <= headingLevel) {
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
export function textBetween(
  markdown: string,
  startPattern: RegExp,
  endPattern: RegExp | null,
  { required = true }: RequiredOption = {},
): string {
  const start: number = markdown.search(startPattern);
  if (start < 0) {
    if (required) throw new Error(`start not found: ${startPattern}`);
    return "";
  }
  const rest: string = markdown.slice(start);
  const end: number = endPattern ? rest.slice(1).search(endPattern) : -1;
  return (end < 0 ? rest : rest.slice(0, end + 1)).trim();
}

function splitRow(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell: string): string => cell.trim().replace(/\\\|/g, "|"));
}

/** All GFM tables in the markdown: { header, rows, text }. */
export function parseTables(markdown: string): readonly Table[] {
  let lines: string[] = markdown.split(/\r?\n/);
  let tables: Table[] = [];
  for (let i: number = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(requireValue(lines[i], "table line")) && /^\s*\|[\s:|-]+\|\s*$/.test(requireValue(lines[i + 1], "table divider"))) {
      let j: number = i + 2;
      while (j < lines.length && /^\s*\|/.test(requireValue(lines[j], "table row"))) j++;
      tables.push({
        header: splitRow(requireValue(lines[i], "table header")),
        rows: lines.slice(i + 2, j).map(splitRow),
        text: lines.slice(i, j).join("\n"),
      });
      i = j;
    }
  }
  return tables;
}

/** First table whose header row matches the regex. */
export function tableWith(markdown: string, headerPattern: RegExp): Table {
  const table: Table | undefined = parseTables(markdown).find((candidate: Table): boolean =>
    headerPattern.test(candidate.header.join("|")),
  );
  if (!table) throw new Error(`table not found: ${headerPattern}`);
  return table;
}

export function tableMarkdown(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  function rowMarkdown(cells: readonly string[]): string {
    return "| " + cells.map((cell: string): string => String(cell).replace(/\|/g, "\\|")).join(" | ") + " |";
  }
  return [rowMarkdown(header), rowMarkdown(header.map((): string => "---")), ...rows.map(rowMarkdown)].join("\n");
}

/** Remove table columns by header name from every table in the markdown. */
function dropColumns(markdown: string, names: readonly string[]): string {
  let result: string = markdown;
  for (const table of parseTables(markdown)) {
    let dropped: number[] = table.header
      .map((heading: string, i: number): number =>
        names.some((name: string): boolean => heading.toLowerCase() === name.toLowerCase()) ? i : -1,
      )
      .filter((i: number): boolean => i >= 0);
    if (!dropped.length) continue;
    function keptCells(cells: readonly string[]): readonly string[] {
      return cells.filter((_: string, i: number): boolean => !dropped.includes(i));
    }
    result = result.replace(table.text, tableMarkdown(keptCells(table.header), table.rows.map(keptCells)));
  }
  return result;
}

/** Drop code addresses of routines and jump tables, internal function names and local file mentions. */
export function scrub(text: string | null | undefined): string {
  let result: string = String(text ?? "")
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
  for (let [pattern, replacement] of localRules.replace) result = result.replace(pattern, replacement);
  return result;
}

let privatePattern: RegExp = new RegExp(
  [
    String.raw`\.py\b`,
    String.raw`[A-Z]:\\`,
    String.raw`\bscripts/`,
    String.raw`\.p2s\b`,
    String.raw`sha256 [0-9a-f]{8}`,
    String.raw`\bevidence\s+\d`,
    ...localRules.private,
  ].join("|"),
  "i",
);

/**
 * Make repo-doc markdown fit for a public page: no private paths, scripts, local links or
 * evidence-capture references. Blocks that are about our tooling rather than the codes are dropped.
 */
function publicMarkdown(markdown: string): string {
  let cleaned: string = scrub(dropColumns(markdown, ["Evidence", "Found from", "Evidence level", "Where it is in SLPS_201.37"]));
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  cleaned = cleaned.replace(/\s*\((?:[^()]*\.py[^()]*|evidence[^()]*|S\d[^()]*evidence[^()]*)\)/gi, "");
  cleaned = cleaned.replace(/\[([^\]]+)\]\((?!https?:|#)[^)]*\)/g, "$1");
  let blocks: string[] = cleaned.split(/\n{2,}/);
  let kept: string[] = [];
  for (const block of blocks) {
    if (/^\s*\|/.test(block)) {
      let rows: string[] = block.split("\n").filter((line: string, i: number): boolean => i < 2 || !privatePattern.test(line));
      kept.push(rows.join("\n"));
    } else if (block.split("\n").some((line: string): boolean => privatePattern.test(line)) && !/^\s*[-*]\s/m.test(block)) {
      continue;
    } else if (/^\s*[-*]\s/m.test(block)) {
      let lines: string[] = block.split("\n");
      let keptLines: string[] = [];
      let isSkipping: boolean = false;
      for (const line of lines) {
        if (/^\s*[-*]\s/.test(line)) isSkipping = privatePattern.test(line);
        else if (privatePattern.test(line)) isSkipping = true;
        if (!isSkipping) keptLines.push(line);
      }
      if (keptLines.length) kept.push(keptLines.join("\n"));
    } else kept.push(block);
  }
  return kept.join("\n\n").trim();
}

let renderer: Renderer<string, string> = new marked.Renderer();
renderer.link = function (this: RendererThis, { href, title, tokens }: Tokens.Link): string {
  const text: string = this.parser.parseInline(tokens);
  const isExternal: boolean = /^https?:/.test(href);
  return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}${isExternal ? ' rel="noopener noreferrer" class="ext"' : ""}>${text}</a>`;
};
renderer.table = function (this: RendererThis, token: Tokens.Table): string {
  const head: string = token.header.map((cell: Tokens.TableCell): string => `<th>${this.parser.parseInline(cell.tokens)}</th>`).join("");
  const body: string = token.rows
    .map(
      (row: Tokens.TableCell[]): string =>
        `<tr>${row.map((cell: Tokens.TableCell): string => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
};
marked.use({ renderer, gfm: true, breaks: false });

type MarkdownOptions = { readonly clean?: boolean; readonly shift?: number };

/** Render repo markdown; headings are shifted so the fragment fits under an h2. */
export function markdownHtml(source: string, { clean = true, shift = 1 }: MarkdownOptions = {}): string {
  let markdown: string = clean ? publicMarkdown(source) : source;
  if (shift)
    markdown = markdown.replace(
      /^(#{1,5})\s/gm,
      (_: string, hashes: string): string => "#".repeat(Math.min(6, hashes.length + shift)) + " ",
    );
  return marked.parse(markdown, { async: false });
}

export function inlineMarkdownHtml(source: string): string {
  return marked.parseInline(source, { async: false });
}

type SectionBuilder = { name: string; author: string; description: string; patches: string[]; lines: string[] };

/** Parse a PCSX2 .pnach: header comments + sections with raw code lines. */
export function parsePnach(text: string): ParsedPnach {
  let sections: SectionBuilder[] = [];
  let current: SectionBuilder | null = null;
  let header: { gametitle: string; comments: string[] } = { gametitle: "", comments: [] };
  for (const line of text.split(/\r?\n/)) {
    let sectionMatch: RegExpMatchArray | null = line.match(/^\[(.+)\]\s*$/);
    if (sectionMatch) {
      current = { name: requireValue(sectionMatch[1], "pnach section name"), author: "", description: "", patches: [], lines: [line] };
      sections.push(current);
      continue;
    }
    if (!current) {
      if (line.startsWith("gametitle=")) header.gametitle = line.slice(10);
      else if (line.startsWith("comment=")) header.comments.push(line.slice(8));
      continue;
    }
    if (!line.trim()) continue;
    current.lines.push(line);
    if (line.startsWith("author=")) current.author = line.slice(7);
    else if (line.startsWith("description=")) current.description = line.slice(12);
    else if (line.startsWith("patch=")) current.patches.push(line);
  }
  return {
    header,
    sections: sections.map(
      (section: SectionBuilder): PnachSection => ({
        name: section.name,
        author: section.author,
        description: section.description,
        patches: section.patches,
        text: section.lines.join("\n"),
        raw: section.patches.map((patch: string): string => {
          const fields: readonly string[] = patch.split(",");
          if (fields.length !== 5 || fields[1] !== "EE" || fields[3] !== "extended") throw new Error(`unexpected patch line: ${patch}`);
          return `${fields[2]} ${fields[4]}`;
        }),
      }),
    ),
  };
}

const REGION_NAMES: Readonly<Record<string, string>> = {
  SLUS: "North America (NTSC-U)",
  SLES: "Europe (PAL)",
  SLPS: "Japan (NTSC-J)",
  SLPM: "Japan (NTSC-J)",
  SLKA: "Korea (NTSC-K)",
};
const REGION_CODES: Readonly<Record<string, string>> = { SLUS: "US", SLES: "EU", SLPS: "JP", SLPM: "JP", SLKA: "KR" };

export function regionName(serial: string): string {
  return REGION_NAMES[serial.slice(0, 4)] ?? "Unknown";
}

export function regionCode(serial: string): string {
  return REGION_CODES[serial.slice(0, 4)] ?? "?";
}
