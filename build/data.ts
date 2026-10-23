import type { DerivedFinding, PublishedFinding, ReleasePin } from "./registry.ts";
import type { ParsedPnach, CatalogFeature } from "./model.ts";
// Reads the cheat docs (read-only) and builds the site model.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseRegistry, parseEvidenceLevel } from "./registry.ts";
import type { Registry } from "./registry.ts";
import { countCodes, requireValue } from "./model.ts";
import type {
  Code,
  CodeDraft,
  CodeFields,
  CodeGroup,
  EvidenceLevel,
  Game,
  GameDefinition,
  GameId,
  LegacyCode,
  PnachSection,
  Release,
  ReleaseInput,
  Site,
  Shared,
  Status,
  Table,
} from "./model.ts";

type CodeEvidence = Pick<CodeFields, "status" | "level" | "checked">;
type MatrixEntry = { readonly status: Status; readonly raw: string; readonly level: string | undefined; readonly checked: string };
type FamilyDefinition = {
  readonly serial: string;
  readonly crc: string;
  readonly file: string;
  readonly gameId: GameId;
  readonly label: string;
  readonly ver: string;
  readonly rowRe: RegExp;
  readonly mapKey: string;
  readonly identRe: RegExp;
  readonly rule: (title: string, release: RegExp) => CodeEvidence | null;
  readonly fallback?: readonly string[] | undefined;
};
const GAME_DEFS: readonly GameDefinition[] = [
  { id: "x", title: "Guilty Gear X", short: "X", slug: "guilty-gear-x" },
  { id: "xx", title: "Guilty Gear XX / X2", short: "XX / X2", slug: "guilty-gear-xx-x2" },
  { id: "reload", title: "Guilty Gear XX #Reload", short: "#Reload", slug: "guilty-gear-xx-reload" },
  { id: "slash", title: "Guilty Gear XX Slash", short: "Slash", slug: "guilty-gear-xx-slash" },
  { id: "ac", title: "Guilty Gear XX Accent Core", short: "AC", slug: "guilty-gear-xx-accent-core" },
  { id: "acplus", title: "Guilty Gear XX Accent Core Plus", short: "AC+", slug: "guilty-gear-xx-accent-core-plus" },
  { id: "isuka", title: "Guilty Gear Isuka", short: "Isuka", slug: "guilty-gear-isuka" },
];
import { loadCatalog, FEATURE_CATEGORIES } from "./catalog.ts";
import { section, between, tableWith, stripMd, parsePnach, regionOf, regionShort, slugify, scrub } from "./lib.ts";

const argSource: string | null | undefined = process.argv.includes("--source") ? process.argv[process.argv.indexOf("--source") + 1] : null;
export const REPO: string = requireValue(
  argSource || process.env["RETRO_REPO"],
  "Set RETRO_REPO or pass --source <path> to the cheat docs checkout.",
);
function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
}
const AC: "games/ggacplus-cheats" = "games/ggacplus-cheats";
const X2: "games/ggx2-cheats" = "games/ggx2-cheats";

const HW: "NOT TESTED" = "NOT TESTED";
export const STATUS_ORDER: readonly Status[] = ["VERIFIED", "INFERRED", "NOT TESTED", "SUPERSEDED"];

const GROUPS: readonly CodeGroup[] = [
  "Everything",
  "Characters and modes",
  "EX characters",
  "Gold, black and SP colours",
  "Progress",
  "Stages",
  "lee4, 2014",
  "lee4, 2009 (superseded)",
  "Passwords",
  ...FEATURE_CATEGORIES,
];
function groupFor(t: string): CodeGroup {
  if (/^Unlock everything/i.test(t)) return "Everything";
  if (/^Stage select|^Load any stage/i.test(t)) return "Stages";
  if (/\bEX\b/.test(t) && !/GG mode and EX/.test(t)) return "EX characters";
  if (/gold|black|\bSP\b/i.test(t)) return "Gold, black and SP colours";
  if (/missions|story endings|gallery|play time/i.test(t)) return "Progress";
  return "Characters and modes";
}

function levelOf(s: string | undefined): EvidenceLevel | null {
  let match: RegExpMatchArray | null = String(s).match(/\bS([0-6])\b/);
  return match ? parseEvidenceLevel(match[0]) : null;
}
function statusOf(s: string | undefined): Status {
  const t: string = stripMd(s).toLowerCase();
  if (t.startsWith("superseded")) return "SUPERSEDED";
  if (t.startsWith("verified")) return "VERIFIED";
  if (t.startsWith("inferred")) return "INFERRED";
  if (t.startsWith("not tested") || t.startsWith("not run")) return "NOT TESTED";
  throw new Error(`Unknown status: ${s}`);
}
function cleanNote(s: string | undefined): string {
  return scrub(stripMd(s))
    .replace(/\s*\([^()]*\.py[^()]*\)/g, "")
    .replace(/^-$/, "")
    .trim();
}

function sourceCommit(): string {
  return execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

function loadRegistry(): Registry {
  return parseRegistry(read(`${AC}/registry.yaml`));
}

// ---------- code builders ----------

function makeCode(sec: PnachSection, extra: Partial<CodeEvidence> & { readonly regId?: string }): LegacyCode {
  const title: string = sec.name;
  return {
    id: slugify(title),
    title,
    group: groupFor(title),
    effect: scrub(sec.description),
    raw: sec.raw,
    pnach: scrub(sec.text),
    author: sec.author,
    status: "INFERRED",
    level: null,
    checked: "",
    hardware: HW,
    ...extra,
  };
}

function uniqueSlugs(codes: readonly CodeDraft[]): readonly CodeDraft[] {
  let seen: Map<string, number> = new Map();
  return codes.map((code: CodeDraft): CodeDraft => {
    const count: number = seen.get(code.id) ?? 0;
    seen.set(code.id, count + 1);
    return count ? { ...code, id: `${code.id}-${count + 1}` } : code;
  });
}

// ---------- main ----------
export function loadSite(): Site {
  const acDoc: string = read(`${AC}/CHEATS.md`);
  const x2Doc: string = read(`${X2}/CHEATS.md`);
  const famDoc: string = read(`${X2}/FAMILY.md`);
  const othDoc: string = read(`${X2}/OTHER_DISCS.md`);
  const R: Registry = loadRegistry();
  const commit: string = sourceCommit();

  // ----- AC+ matrix: status per code title -----
  const matrixDoc: string = between(acDoc, /<!-- MATRIX -->/, /<!-- \/MATRIX -->/);
  const matrix: ReadonlyMap<string, MatrixEntry> = new Map(
    tableWith(matrixDoc, /Code\|Code types\|Status/).rows.map(
      (r: readonly string[]): [string, { status: Status; raw: string; level: string | undefined; checked: string }] => [
        stripMd(r[0]),
        { status: statusOf(r[2]), raw: stripMd(r[2]), level: r[3], checked: cleanNote(r[4]) },
      ],
    ),
  );
  const verification: Table = tableWith(acDoc, /Code\|Status\|Measured result/);

  const testEnv: Registry["reg"]["test_environment"] = R.reg.test_environment;
  const testSetup: ReadonlyArray<readonly [string, string]> = [
    ["Emulator", testEnv.emulator],
    ["Starting point", "Fresh save at the main menu"],
    ["Cheat devices", testEnv.hardware_devices],
  ];

  // ----- AC+ shared prose -----
  const priorWork: string = between(acDoc, /\*\*Prior work\.\*\*/, /\nThis document adds the following:/);
  const sources: string = section(acDoc, "## Prior work and sources");
  const sourcesTable: Table = tableWith(sources, /Source\|Author, date/);
  const lee4Where: Table = tableWith(sources, /lee4 code\|2014/);
  const lee4Tests: Table = tableWith(sources, /2014 \(lee4's post\)/);
  const masterCode: string | undefined = (acDoc.match(/master code, `([0-9A-F ]+)`/) || [])[1];
  if (!masterCode) throw new Error("master code not found");
  const sideEffect: string = between(sources, /\*\*The SE\/VOICE side effect, explained/, /\*\*Both versions tested/);
  const verdict: string = requireValue(between(sources, /\*\*Verdict: /, null).split("\n\n")[0], "verdict");
  const playTime: Table = tableWith(acDoc, /Play time\|Unlock/);
  const timeSep: string = between(acDoc, /Separately, the stage select grants/, /\n\n/);
  const stageTable: Table = tableWith(section(acDoc, "## Stage table"), /Stage\|Accent Core/);
  const stageFlags: Table = tableWith(between(acDoc, /<!-- STAGEFLAGS -->/, /<!-- \/STAGEFLAGS -->/), /Entry\|Stage\|Enabled by/);
  const stageStates: Table = tableWith(acDoc, /State\|Selectable entries/);
  const fieldMap: Table = tableWith(acDoc, /Offset\|Size\|Meaning/);
  const quickStart: Table = tableWith(acDoc, /You want\|Enable\|Then/);
  const charactersMd: string = section(acDoc, "## Characters");
  const caveatsMd: string = section(acDoc, "## Caveats");
  const howTo: string = section(acDoc, "## How to use the codes");
  const accept: string = between(acDoc, /\*\*Forced-only entries load and play/, /\*\*Guide claims, checked against this disc\.\*\*/);
  const jpDoc: string = section(acDoc, "## Japanese releases (separate findings)");
  const jpRuntime: Table = tableWith(jpDoc, /Test\|Result\|Level/);
  const jpSingle: string = between(jpDoc, /The single-character codes run on/, /\n\n/).replace(/\n/g, " ");
  const jpAppend: string = scrub(between(jpDoc, /\*\*Append Edition: not run\.\*\*/, /\n\n/).replace(/\n/g, " "));
  const jpIdent: Table = tableWith(jpDoc, /Release\|Disc \(Redump\)/);
  const guideClaims: string = between(
    acDoc,
    /\*\*Guide claims, checked against this disc\.\*\*/,
    /\*\*Are the hidden entries copies\?\*\*/,
  ).replace(/^\*\*Guide claims[^*]*\*\*\s*/, "");

  // ----- Release identity tables (other docs) -----
  const famIdent: Table = tableWith(famDoc, /Release\|ELF, version, PCSX2 CRC/);
  const othIdent: Table = tableWith(othDoc, /Game\|Serial, version/);
  const famRows: ReadonlyArray<readonly string[]> = tableWith(famDoc, /Release\|Code\|Status\|Seen/).rows;
  const famMaps: Readonly<Record<string, string>> = Object.fromEntries(
    [...famDoc.matchAll(/^- \*\*([^*]+):\*\*([\s\S]*?)(?=^- \*\*|^- Taikenban|^## )/gm)].map((m: RegExpExecArray): [string, string] => [
      requireValue(m[1], "family name").trim(),
      `**${requireValue(m[1], "family name").trim()}:**${m[2]}`.trim(),
    ]),
  );

  // ===== Release factory =====
  let releases: Release[] = [];
  function addRelease(input: ReleaseInput): Release {
    const slug: string = input.slug ?? slugify(`${regionShort(input.serial)}-${input.serial}`);
    const game: GameDefinition = requireValue(
      GAME_DEFS.find((candidate: GameDefinition): boolean => candidate.id === input.gameId),
      "game definition",
    );
    const url: string = `/games/${game.slug}/${slug}/`;
    let codes: readonly CodeDraft[] = uniqueSlugs(input.codes);
    let release: Release = {
      ...input,
      slug,
      game,
      url,
      region: regionOf(input.serial),
      regionShort: regionShort(input.serial),
      counts: countCodes(codes),
      codes: [],
      patchSections: 0,
    };
    release.codes = codes.map((code: CodeDraft): Code => ({ ...code, release, url: `${url}${code.id}/` }));
    releases.push(release);
    return release;
  }

  function ident(tbl: Table, rowRe: RegExp, serial: string, crc: string): readonly string[] {
    const row: readonly string[] | undefined = tbl.rows.find((r: readonly string[]): boolean =>
      rowRe.test(requireValue(r[0], "row label")),
    );
    if (!row) throw new Error(`identity row not found: ${rowRe}`);
    if (
      !row.join(" ").includes(serial.replace("-", "_").replace(/^(\w{4}_)(\d{3})(\d{2})$/, "$1$2.$3")) &&
      !row.join(" ").includes(serial)
    ) {
      // serial may appear as SLUS_204.36 or SLUS-20436
      const alt: string = serial.replace("-", "_").replace(/(\d{3})(\d{2})$/, "$1.$2");
      if (!row.join(" ").includes(alt)) throw new Error(`serial ${serial} not in row ${requireValue(row[0], "source row field")}`);
    }
    if (!row.join(" ").toUpperCase().includes(crc)) throw new Error(`crc ${crc} not in row ${requireValue(row[0], "source row field")}`);
    return row;
  }

  // ----- AC+ US -----
  {
    const pn: ParsedPnach = parsePnach(read(`${AC}/F233A433.pnach`));
    const R0: Registry["reg"]["release"] = R.reg.release;
    let codes: CodeDraft[] = pn.sections.map((s: PnachSection): LegacyCode => {
      const d: DerivedFinding | undefined = R.derived.get(s.name);
      if (!d) throw new Error(`pnach section without registry record: ${s.name}`);
      if (d.raw_code.join("|") !== s.raw.join("|")) throw new Error(`raw code differs between registry and pnach: ${s.name}`);
      const m: MatrixEntry | undefined = matrix.get(s.name);
      if (!m) throw new Error(`no matrix row: ${s.name}`);
      const v: readonly string[] | undefined = verification.rows.find((r: readonly string[]): boolean => stripMd(r[0]) === s.name);
      const checked: string = m.checked && m.checked !== "-" ? m.checked : v ? cleanNote(v[2]) : "";
      return makeCode(s, { level: d.evidence_level, status: m.status, checked, regId: d.finding_id });
    });
    // lee4 published codes
    let byFeature: Map<string, PublishedFinding> = new Map(
      R.published.map((p: PublishedFinding): [string, PublishedFinding] => [p.finding_id, p]),
    );
    for (const p of R.published) {
      const yr: string = String(p.source_date).slice(0, 4);
      const key: string = `lee4 ${yr}: ${p.title}`;
      const m: MatrixEntry | undefined = matrix.get(key);
      if (!m) throw new Error(`no matrix row: ${key}`);
      const mate: PublishedFinding | null | undefined = p.conflicts_with?.[0] ? byFeature.get(p.conflicts_with[0]) : null;
      const sectionName: string = `${key}`;
      const pnachText: string =
        `[${sectionName}]\nauthor=lee4\n` +
        (yr === "2009" ? "comment=Superseded: every save address is 8 bytes below the 2014 version.\n" : "") +
        p.generated_pnach.join("\n");
      codes.push({
        id: `lee4-${yr}-${slugify(p.title)}`,
        title: key,
        shortTitle: p.title,
        group: yr === "2014" ? "lee4, 2014" : "lee4, 2009 (superseded)",
        effect: scrub(p.provenance_note),
        raw: p.raw_code,
        pnach: pnachText,
        author: p.source_author,
        status: m.status,
        statusNote: m.raw.replace(/\*\*/g, ""),
        level: p.evidence_level,
        checked: m.checked,
        hardware: HW,
        published: {
          author: p.source_author,
          date: String(p.source_date),
          url: p.source_url,
          ...(p.source_archive === undefined ? {} : { archive: p.source_archive }),
          ...(p.source_mirror === undefined ? {} : { mirror: p.source_mirror }),
          year: yr,
        },
        mateId: mate ? `lee4-${String(mate.source_date).slice(0, 4)}-${slugify(mate.title)}` : null,
      });
    }
    addRelease({
      gameId: "acplus",
      slug: "us-slus-21847",
      label: "US",
      serial: "SLUS-21847",
      version: "1.00",
      crc: R0.elf.pcsx2_crc,
      elf: { name: R0.elf.name, size: R0.elf.size, sha256: R0.elf.sha256 },
      disc: { redump: R0.disc.redump_url, crc32: R0.disc.crc32, sha1: R0.disc.sha1, size: R0.disc.size, date: R0.disc.exe_date },
      pnachFile: "F233A433.pnach",
      pnachText: scrub(read(`${AC}/F233A433.pnach`)),
      codes,
      hasLee4: true,
      unlock: { kind: "acplus" },
    });
  }

  // ----- AC+ JP / Append -----
  function jpRule(title: string, append: boolean): CodeEvidence {
    if (append) return { status: "NOT TESTED", level: "S1", checked: jpAppend };
    function row(re: RegExp): readonly string[] {
      return requireValue(
        jpRuntime.rows.find((r: readonly string[]): boolean => re.test(requireValue(r[0], "JP row title"))),
        "JP runtime row",
      );
    }
    if (/^Unlock everything$/.test(title)) {
      const a: readonly string[] = row(/^\*\*Unlock everything\*\*$/);
      const b: readonly string[] = row(/^Saved with/);
      return { status: "VERIFIED", level: "S4", checked: `${stripMd(a[1])} ${stripMd(b[1])}` };
    }
    if (/^Stage select: all 34/.test(title) || /^Stage select: hidden stages too/.test(title)) {
      const a: readonly string[] = row(/Stage select: all 34/);
      return { status: "VERIFIED", level: "S2", checked: stripMd(a[1]) };
    }
    return { status: "INFERRED", level: "S1", checked: jpSingle };
  }
  const jpReleases: ReadonlyArray<readonly [string, string, string, boolean, string]> = [
    ["SLPM-66965", "61FE9C13", "SLPM-66965_61FE9C13.pnach", false, "JP"],
    ["SLPM-66964", "45D92B79", "SLPM-66964_45D92B79.pnach", true, "JP Append"],
  ];
  for (let [serial, crc, file, append, label] of jpReleases) {
    const pins: ReleasePin | undefined = R.releasePins.find((p: ReleasePin): boolean => p.serial === serial);
    if (!pins || pins.elf_crc !== crc) throw new Error(`release pin mismatch ${serial}`);
    const row: readonly string[] = requireValue(
      jpIdent.rows.find((r: readonly string[]): boolean => requireValue(r[0], "release serial").includes(serial)),
      "JP identity",
    );
    const pn: ParsedPnach = parsePnach(read(`${AC}/jp/${file}`));
    let codes: CodeDraft[] = pn.sections.map((s: PnachSection): LegacyCode => {
      if (!R.derived.has(s.name)) throw new Error(`JP section not in US registry: ${s.name}`);
      return makeCode(s, jpRule(s.name, append));
    });
    addRelease({
      gameId: "acplus",
      slug: `${label.startsWith("JP A") ? "jp-append" : "jp"}-${serial.toLowerCase()}`,
      label,
      serial,
      version: pins.game_version,
      crc,
      elf: { name: requireValue(requireValue(row[2], "source row field").split(",")[0], "ELF name").trim(), sha256: pins.elf_sha256 },
      disc: { redump: `http://redump.org/disc/${pins.redump_id}/`, crc32: pins.disc_crc32, sha1: pins.disc_sha1 },
      pnachFile: file,
      pnachText: read(`${AC}/jp/${file}`),
      codes,
      unlock: { kind: "acplus", jp: true, append },
      note: append ? jpAppend : null,
    });
  }

  // ----- X2 US -----
  {
    const pn: ParsedPnach = parsePnach(read(`${X2}/SLUS-20436_913FBFB8.pnach`));
    const v: ReadonlyArray<readonly string[]> = tableWith(x2Doc, /Code\|Status\|Measured result/).rows;
    function find(re: RegExp): readonly string[] | undefined {
      return v.find((r: readonly string[]): boolean => re.test(stripMd(r[0])));
    }
    function rowFor(t: string): readonly string[] | undefined {
      if (/^Unlock everything/.test(t)) return find(/^Unlock everything/);
      if (/^Unlock (Robo-Ky|Kliff|Justice)$/.test(t)) return find(/Robo-Ky \/ Kliff \/ Justice/);
      if (t === "Unlock GG mode") return find(/^Unlock GG mode/);
      if (t === "Unlock all SP colours") return find(/^Unlock all SP colours/);
      if (t === "Unlock all EX characters") return find(/^Unlock all EX characters/);
      if (t === "Unlock SP Sol Badguy") return find(/^Unlock all SP colours/);
      if (t === "Unlock EX Sol Badguy") return find(/^Unlock all EX characters/);
      if (t === "Max play time") return find(/^Max play time/);
      return find(/^Unlock EX \/ SP \(one character\)/);
    }
    let codes: CodeDraft[] = pn.sections.map((s: PnachSection): LegacyCode => {
      const r: readonly string[] | undefined = rowFor(s.name);
      if (!r) throw new Error(`X2 status row missing for ${s.name}`);
      const st: Status = statusOf(r[1]);
      let checked: string = stripMd(r[2]);
      const forSol: boolean = /for Sol/.test(stripMd(r[1])) && !/Sol Badguy$/.test(s.name) && /all (EX|SP)/.test(s.name);
      if (forSol) checked = `Checked with Sol only. ${checked}`;
      return makeCode(s, { status: st, level: levelOf(r[2]) ?? levelOf(r[1]), checked });
    });
    const row: readonly string[] = ident(othIdent, /X2/, "SLUS-20436", "913FBFB8");
    addRelease({
      gameId: "xx",
      slug: "us-slus-20436",
      label: "US X2",
      serial: "SLUS-20436",
      version: "1.00",
      crc: "913FBFB8",
      elf: { name: "SLUS_204.36", sha256: stripMd(requireValue(row[3], "source row field")) },
      imageInfo: stripMd(requireValue(row[4], "source row field")),
      pnachFile: "SLUS-20436_913FBFB8.pnach",
      pnachText: read(`${X2}/SLUS-20436_913FBFB8.pnach`),
      codes,
      unlock: { kind: "x2" },
    });
  }

  // ----- Family releases (AC US, Slash JP, #Reload KR/JP, GGXX JP) -----
  function famRow(relRe: RegExp, codeRe: RegExp): readonly string[] {
    return requireValue(
      famRows.find((r: readonly string[]): boolean => relRe.test(stripMd(r[0])) && codeRe.test(stripMd(r[1]))),
      "family status row",
    );
  }
  function famStatus(row: readonly string[], over: Partial<CodeEvidence> = {}): CodeEvidence {
    const st: Status = /prior art/i.test(requireValue(row[2], "source row field")) ? "VERIFIED" : statusOf(row[2]);
    const lv: EvidenceLevel | null = levelOf(requireValue(row[2], "source row field"));
    const seen: string = stripMd(requireValue(row[3], "source row field"));
    return {
      status: st,
      level: lv,
      checked: cleanNote(`${stripMd(requireValue(row[2], "source row field")).replace(/\*/g, "")}${seen ? ". " + seen : ""}`),
      ...over,
    };
  }
  function persist(relRe: RegExp): readonly string[] {
    return famRow(relRe, /^Persistence/);
  }
  const lastInferred: readonly string[] | undefined = famRows.find((r: readonly string[]): boolean =>
    /#Reload \(Japan\), GGXX/.test(stripMd(r[0])),
  );
  let fam: readonly FamilyDefinition[] = [
    {
      serial: "SLUS-21652",
      crc: "A8A76AAC",
      file: "SLUS-21652_A8A76AAC.pnach",
      gameId: "ac",
      label: "US",
      ver: "1.00",
      rowRe: /^Accent Core \(US\)/,
      mapKey: "Accent Core (US)",
      identRe: /^Accent Core \(US\)/,
      rule: (t: string, rel: RegExp): CodeEvidence | null => {
        if (t === "Unlock all EX characters") return famStatus(famRow(rel, /^Unlock all EX/));
        if (t === "Max play time") return famStatus(famRow(rel, /^Max play time/));
        if (t === "Unlock gold/black Sol Badguy" || t === "Unlock gold/black Ky Kiske")
          return famStatus(famRow(rel, /^Unlock gold\/black, single/), { status: "VERIFIED" });
        if (t === "Unlock all gold and black colours") return famStatus(persist(rel), { status: "VERIFIED" });
        return null;
      },
    },
    {
      serial: "SLPM-66333",
      crc: "06DE61E0",
      file: "SLPM-66333_06DE61E0.pnach",
      gameId: "slash",
      label: "JP",
      ver: "1.01",
      rowRe: /^Slash \(Japan\)/,
      mapKey: "Slash (Japan)",
      identRe: /^Slash \(Japan\)/,
      rule: (t: string, rel: RegExp): CodeEvidence => {
        if (t === "Unlock Kliff and Justice") return famStatus(famRow(rel, /^Unlock Kliff/));
        if (t === "Unlock GG mode and EX characters") return famStatus(famRow(rel, /^Unlock GG mode/));
        return famStatus(persist(rel), { status: "VERIFIED" });
      },
    },
    {
      serial: "SLKA-25070",
      crc: "90F292F7",
      file: "SLKA-25070_90F292F7.pnach",
      gameId: "reload",
      label: "KR",
      ver: "1.01",
      rowRe: /^#Reload \(Korea\)/,
      mapKey: "#Reload (Korea)",
      identRe: /^#Reload \(Korea\)/,
      rule: (t: string, rel: RegExp): CodeEvidence | null => {
        if (t === "Unlock hidden characters and GG mode") return famStatus(famRow(rel, /^Unlock hidden/));
        if (t === "Unlock all SP colours") return famStatus(famRow(rel, /^SP colour, single/), { status: "VERIFIED" });
        if (t === "Unlock all EX characters") return famStatus(persist(rel), { status: "VERIFIED" });
        return null;
      },
    },
    {
      serial: "SLPS-25261",
      crc: "21FCC394",
      file: "SLPS-25261_21FCC394.pnach",
      gameId: "reload",
      label: "JP",
      ver: "1.01",
      rowRe: /^#Reload \(Japan\)$/,
      mapKey: "#Reload (Japan)",
      identRe: /^#Reload \(Japan\)/,
      rule: (t: string, rel: RegExp): CodeEvidence | null =>
        t === "Unlock hidden characters and GG mode" ? famStatus(famRow(rel, /^Unlock hidden/)) : null,
      fallback: lastInferred,
    },
    {
      serial: "SLPS-25184",
      crc: "4B6DDB6B",
      file: "SLPS-25184_4B6DDB6B.pnach",
      gameId: "xx",
      label: "JP XX",
      ver: "2.00",
      rowRe: /^Guilty Gear XX \(Japan\)/,
      mapKey: "Guilty Gear XX (Japan)",
      identRe: /^Guilty Gear XX \(Japan\)/,
      rule: (t: string, rel: RegExp): CodeEvidence | null =>
        t === "Unlock Robo-Ky, Kliff, Justice and GG mode" ? famStatus(famRow(rel, /^Unlock Robo-Ky/)) : null,
      fallback: lastInferred,
    },
  ];
  for (let f of fam) {
    const text: string = read(`${X2}/${f.file}`);
    const pn: ParsedPnach = parsePnach(text);
    let codes: CodeDraft[] = pn.sections.map((s: PnachSection): LegacyCode => {
      const r: CodeEvidence | null = f.rule(s.name, f.rowRe);
      if (r) return makeCode(s, r);
      const fb: readonly string[] | null = f.fallback ?? null;
      if (fb) return makeCode(s, { status: "INFERRED", level: null, checked: cleanNote(stripMd(fb[3])) });
      return makeCode(s, { status: "INFERRED", level: null, checked: "" });
    });
    const row: readonly string[] = ident(famIdent, f.identRe, f.serial, f.crc);
    addRelease({
      gameId: f.gameId,
      slug: `${regionShort(f.serial).toLowerCase()}-${f.serial.toLowerCase()}`,
      label: f.label,
      serial: f.serial,
      version: f.ver,
      crc: f.crc,
      elf: {
        name: requireValue(requireValue(row[1], "source row field").split(",")[0], "ELF name").trim(),
        sha256: stripMd(requireValue(row[2], "source row field")),
      },
      imageInfo: stripMd(requireValue(row[3], "source row field")),
      pnachFile: f.file,
      pnachText: text,
      codes,
      unlock: { kind: "family", mapKey: f.mapKey, rowRe: f.rowRe },
      famName: f.mapKey,
    });
  }

  // ----- X (US): button code + RAM write -----
  const xSec: string = section(othDoc, "## Guilty Gear X (US): prior art plus a first lab result").replace(
    / One scripted attempt at\s+the button code did not register; the input timing on the title screen still needs work\./,
    "",
  );
  const xPlusSec: string = section(othDoc, "## Guilty Gear X Plus (JP): password table decoded").replace(
    /,\s+at\s+0x5C8A20\s+\.\.\.\s+0x5C8A60\.\s+A\s+screen\s+routine(?:\s+\(0x[0-9A-F]+\))?\s+shows\s+one\s+of\s+them\s+when\s+a\s+state\s+value\s+\(\+0x40C\)\s+is\s+3\s+\(KDOKBNZY\),\s+11\s+\(ADROPOUT\)\s+or\s+19\s+\(BLACKMAS\)\./,
    ".",
  );
  const isukaSec: string = section(othDoc, "## Guilty Gear Isuka (US): pinned, not mapped");
  {
    const row: readonly string[] = ident(othIdent, /^Guilty Gear X \(US\)/, "SLUS-20287", "861BFB2F");
    const seq: string | undefined = (xSec.match(/\(Down, Right, Right, Up, then Start\)/) || [])[0];
    if (!seq) throw new Error("X title-screen sequence not found");
    let ram: RegExpMatchArray | null = xSec.match(/\*\*0x([0-9A-F]{6}) = (\d)\*\*/);
    if (!ram) throw new Error("X RAM write not found");
    const ramAddr: string = requireValue(ram[1], "source row field").padStart(8, "0");
    const ramVal: string = requireValue(ram[2], "source row field").padStart(8, "0");
    const lab: string = between(xSec, /- The title-screen code works/, /\n  - With the code, Dizzy/)
      .replace(/^- /, "")
      .replace(/\n\s+/g, " ");
    const codes: readonly LegacyCode[] = [
      {
        id: "dizzy-and-testament-title-screen",
        title: "Dizzy and Testament (title-screen code)",
        group: "Characters and modes",
        effect: "Dizzy and Testament appear at the bottom of the character select grid.",
        raw: ["Down, Right, Right, Up, Start"],
        rawKind: "buttons",
        pnach: null,
        status: "VERIFIED",
        level: "S2",
        checked: `${lab} Community-documented code; see the credits for sources.`,
        hardware: HW,
        inputNote: "Enter it while PRESS START BUTTON is showing: 20-frame presses, 60 frames apart.",
      },
      {
        id: "dizzy-and-testament-ram",
        title: "Dizzy and Testament (memory write)",
        group: "Characters and modes",
        effect: "Dizzy and Testament on the select grid. The screen is pixel-identical to the one the title-screen code gives.",
        raw: [`${ramAddr} ${ramVal}`],
        pnach: `[Dizzy and Testament (memory write)]\npatch=1,EE,${ramAddr},extended,${ramVal}`,
        status: "VERIFIED",
        level: "S2",
        checked: "Found by diffing RAM against two code-free cold boots. Not yet checked: whether it is saved to the memory card.",
        hardware: HW,
      },
    ];
    addRelease({
      gameId: "x",
      slug: "us-slus-20287",
      label: "US",
      serial: "SLUS-20287",
      version: "2.00",
      crc: "861BFB2F",
      elf: { name: "SLUS_202.87", sha256: stripMd(requireValue(row[3], "source row field")) },
      imageInfo: stripMd(requireValue(row[4], "source row field")),
      codes,
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "x", md: xSec },
    });
  }

  // ----- X Plus (JP): passwords -----
  {
    const row: readonly string[] = ident(othIdent, /^Guilty Gear X Plus/, "SLPS-20137", "4191CC06");
    const pwTable: Table = tableWith(xPlusSec, /#\|Password\|Action/);
    const dirTable: Table = tableWith(xPlusSec, /Password\|Direction/);
    const faq: ReadonlyArray<readonly [string, string]> = [...xPlusSec.matchAll(/^- `([A-Z0-9]{8})`: ([^;.\n]+)/gm)].map(
      (m: RegExpMatchArray): readonly [string, string] => [requireValue(m[1], "password"), requireValue(m[2], "password description")],
    );
    const faqMap: ReadonlyMap<string, string> = new Map(faq);
    const levelNote: string = between(xPlusSec, /\*\*What the unlock levels do/, null);
    const faqLink: '[skuldnoshinpu\'s "Additions FAQ" on GameFAQs](https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663)' =
      '[skuldnoshinpu\'s "Additions FAQ" on GameFAQs](https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663)';
    const codes: readonly LegacyCode[] = pwTable.rows.map((r: readonly string[]): LegacyCode => {
      const pw: string = stripMd(r[1]);
      const action: string = stripMd(r[2]);
      const cited: boolean = faqMap.has(pw);
      const none: boolean = /same path as a wrong password/.test(action);
      return {
        id: `password-${pw.toLowerCase()}`,
        title: `Password ${pw}`,
        group: "Passwords",
        effect: cited
          ? `${requireValue(faqMap.get(pw), "password description").charAt(0).toUpperCase()}${requireValue(faqMap.get(pw), "password description").slice(1)}.`
          : none
            ? "No effect in this build."
            : pw === "7IRAKUSA"
              ? "Unlocks Kliff."
              : "Unlocks Justice.",
        raw: [pw],
        rawKind: "password",
        pnach: null,
        status: "INFERRED",
        level: "S1",
        checked: cited
          ? `Listed in the community FAQ and present in the executable's password table. ${action}.`
          : none
            ? `Present in the executable's password table; ${action}.`
            : `Not found in English or Japanese searches. Found in the executable's password table: ${action}. The level it sets was tested with a memory write (S2); the password was not typed in.`,
        credit: cited ? faqLink : null,
        hardware: HW,
      };
    });
    addRelease({
      gameId: "x",
      slug: "jp-slps-20137",
      label: "JP X Plus",
      serial: "SLPS-20137",
      version: "1.03",
      crc: "4191CC06",
      elf: { name: "SLPS_201.37", sha256: stripMd(requireValue(row[3], "source row field")) },
      imageInfo: stripMd(requireValue(row[4], "source row field")),
      codes,
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "xplus", md: xPlusSec, dirTable, levelNote, faqLink },
    });
  }

  // ----- Isuka (US) and Taikenban: pinned only -----
  {
    const row: readonly string[] = ident(othIdent, /^Guilty Gear Isuka/, "SLUS-20908", "054DED36");
    addRelease({
      gameId: "isuka",
      slug: "us-slus-20908",
      label: "US",
      serial: "SLUS-20908",
      version: "1.00",
      crc: "054DED36",
      elf: { name: "SLUS_209.08", sha256: stripMd(requireValue(row[3], "source row field")) },
      imageInfo: stripMd(requireValue(row[4], "source row field")),
      codes: [],
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "isuka", md: isukaSec },
    });
    const t: readonly string[] = requireValue(
      famIdent.rows.find((r: readonly string[]): boolean => /Taikenban/.test(requireValue(r[0], "trial release"))),
      "trial identity",
    );
    addRelease({
      gameId: "xx",
      slug: "jp-slpm-60193",
      label: "JP Taikenban",
      serial: "SLPM-60193",
      version: "1.00",
      crc: "7CF7B5DA",
      elf: { name: "SLPM_601.93", sha256: stripMd(requireValue(t[2], "source row field")) },
      imageInfo: stripMd(requireValue(t[3], "source row field")),
      codes: [],
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "taikenban", md: requireValue(famMaps["Taikenban (trial)"], "trial description") },
    });
  }

  // Catalog drafts never enter the public model or the downloads list.
  let features: CatalogFeature[] = loadCatalog(REPO, releases);
  for (let feature of features) feature.release.codes.push(feature);
  for (let release of releases) {
    release.counts = countCodes(release.codes);
    release.patchSections =
      (release.pnachText ? parsePnach(release.pnachText).sections.length : 0) +
      features
        .filter((feature: CatalogFeature): boolean => feature.release === release)
        .reduce((n: number, feature: CatalogFeature): number => n + (feature.artifact?.sectionCount ?? 0), 0);
  }

  // ----- Games -----
  let games: readonly Game[] = GAME_DEFS.map(
    (g: GameDefinition): Game => ({ ...g, releases: releases.filter((r: Release): boolean => r.gameId === g.id) }),
  );

  const shared: Shared = {
    priorWork,
    sourcesTable,
    lee4Where,
    lee4Tests,
    masterCode,
    sideEffect,
    verdict,
    playTime,
    timeSep,
    stageTable,
    stageFlags,
    stageStates,
    fieldMap,
    quickStart,
    charactersMd,
    caveatsMd,
    howTo,
    accept,
    jpDoc,
    jpRuntime,
    jpSingle,
    jpAppend,
    guideClaims,
    verification,
    testSetup,
    famMaps,
    famRows,
    x2Doc,
    famDoc,
    othDoc,
    acDoc,
    evidenceLevels: R.reg.evidence_levels,
    claims: R.claims,
    registryCount: R.count,
    commit,
  };
  return { games, releases, shared, GROUPS, features, built: "", priorMap: new Map() };
}
