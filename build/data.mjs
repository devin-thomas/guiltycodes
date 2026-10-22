// Reads the cheat docs (read-only) and builds the site model.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { loadCatalog, FEATURE_CATEGORIES } from "./catalog.mjs";
import { section, between, tableWith, parseTables, tableToMd, stripMd, md, mdInline, parsePnach, regionOf, regionShort, slugify, cleanMd, scrub } from "./lib.mjs";

const argSource = process.argv.includes("--source") ? process.argv[process.argv.indexOf("--source") + 1] : null;
export const REPO = argSource || process.env.RETRO_REPO;
if (!REPO) throw new Error("Set RETRO_REPO or pass --source <path> to the cheat docs checkout.");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const AC = "games/ggacplus-cheats";
const X2 = "games/ggx2-cheats";

const HW = "NOT TESTED";
export const STATUS_ORDER = ["VERIFIED", "INFERRED", "NOT TESTED", "SUPERSEDED"];

const GROUPS = [
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
const groupFor = (t) => {
  if (/^Unlock everything/i.test(t)) return "Everything";
  if (/^Stage select|^Load any stage/i.test(t)) return "Stages";
  if (/\bEX\b/.test(t) && !/GG mode and EX/.test(t)) return "EX characters";
  if (/gold|black|\bSP\b/i.test(t)) return "Gold, black and SP colours";
  if (/missions|story endings|gallery|play time/i.test(t)) return "Progress";
  return "Characters and modes";
};

const levelOf = (s) => (String(s).match(/\bS([0-6])\b/) ? `S${String(s).match(/\bS([0-6])\b/)[1]}` : null);
const statusOf = (s) => {
  const t = stripMd(s).toLowerCase();
  if (t.startsWith("superseded")) return "SUPERSEDED";
  if (t.startsWith("verified")) return "VERIFIED";
  if (t.startsWith("inferred")) return "INFERRED";
  if (t.startsWith("not tested") || t.startsWith("not run")) return "NOT TESTED";
  return null;
};
const cleanNote = (s) =>
  scrub(stripMd(s))
    .replace(/\s*\([^()]*\.py[^()]*\)/g, "")
    .replace(/^-$/, "")
    .trim();

function sourceCommit() {
  try {
    const h = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    return h;
  } catch {
    return "unknown";
  }
}

// ---------- registry (AC+ US) ----------
function loadRegistry() {
  const reg = YAML.parse(read(`${AC}/registry.yaml`));
  const f = reg.findings;
  return {
    reg,
    published: f.filter((x) => x.claim_kind === "published-code"),
    derived: new Map(f.filter((x) => x.claim_kind === "derived-code").map((x) => [x.title, x])),
    releasePins: f.filter((x) => x.claim_kind === "release"),
    claims: f.filter((x) => x.claim_kind === "published-claim"),
    count: f.length,
  };
}

// ---------- code builders ----------
const rawFromPnach = (s) => s.raw;

function makeCode(rel, sec, extra) {
  const title = sec.name;
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

function uniqueSlugs(codes) {
  const seen = new Map();
  for (const c of codes) {
    let s = c.id;
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    if (n) c.id = `${s}-${n + 1}`;
  }
}

// ---------- main ----------
export function loadSite() {
  const acDoc = read(`${AC}/CHEATS.md`);
  const x2Doc = read(`${X2}/CHEATS.md`);
  const famDoc = read(`${X2}/FAMILY.md`);
  const othDoc = read(`${X2}/OTHER_DISCS.md`);
  const R = loadRegistry();
  const commit = sourceCommit();

  // ----- AC+ matrix: status per code title -----
  const matrixDoc = between(acDoc, /<!-- MATRIX -->/, /<!-- \/MATRIX -->/);
  const matrix = new Map(
    tableWith(matrixDoc, /Code\|Code types\|Status/).rows.map((r) => [stripMd(r[0]), { status: statusOf(r[2]), raw: stripMd(r[2]), level: r[3], checked: cleanNote(r[4]) }]),
  );
  const verification = tableWith(acDoc, /Code\|Status\|Measured result/);

  const testEnv = R.reg.test_environment;
  const testSetup = [
    ["Emulator", testEnv.emulator],
    ["Starting point", "Fresh save at the main menu"],
    ["Cheat devices", testEnv.hardware_devices],
  ];

  const sites = {};

  // ----- AC+ shared prose -----
  const priorWork = between(acDoc, /\*\*Prior work\.\*\*/, /\nThis document adds the following:/);
  const sources = section(acDoc, "## Prior work and sources");
  const sourcesTable = tableWith(sources, /Source\|Author, date/);
  const lee4Where = tableWith(sources, /lee4 code\|2014/);
  const lee4Tests = tableWith(sources, /2014 \(lee4's post\)/);
  const masterCode = (acDoc.match(/master code, `([0-9A-F ]+)`/) || [])[1];
  if (!masterCode) throw new Error("master code not found");
  const sideEffect = between(sources, /\*\*The SE\/VOICE side effect, explained/, /\*\*Both versions tested/);
  const verdict = between(sources, /\*\*Verdict: /, null).split("\n\n")[0];
  const playTime = tableWith(acDoc, /Play time\|Unlock/);
  const timeSep = between(acDoc, /Separately, the stage select grants/, /\n\n/);
  const stageTable = tableWith(section(acDoc, "## Stage table"), /Stage\|Accent Core/);
  const stageFlags = tableWith(between(acDoc, /<!-- STAGEFLAGS -->/, /<!-- \/STAGEFLAGS -->/), /Entry\|Stage\|Enabled by/);
  const stageStates = tableWith(acDoc, /State\|Selectable entries/);
  const fieldMap = tableWith(acDoc, /Offset\|Size\|Meaning/);
  const quickStart = tableWith(acDoc, /You want\|Enable\|Then/);
  const charactersMd = section(acDoc, "## Characters");
  const caveatsMd = section(acDoc, "## Caveats");
  const howTo = section(acDoc, "## How to use the codes");
  const accept = between(acDoc, /\*\*Forced-only entries load and play/, /\*\*Guide claims, checked against this disc\.\*\*/);
  const jpDoc = section(acDoc, "## Japanese releases (separate findings)");
  const jpRuntime = tableWith(jpDoc, /Test\|Result\|Level/);
  const jpSingle = between(jpDoc, /The single-character codes run on/, /\n\n/).replace(/\n/g, " ");
  const jpAppend = scrub(between(jpDoc, /\*\*Append Edition: not run\.\*\*/, /\n\n/).replace(/\n/g, " "));
  const jpIdent = tableWith(jpDoc, /Release\|Disc \(Redump\)/);
  const guideClaims = between(acDoc, /\*\*Guide claims, checked against this disc\.\*\*/, /\*\*Are the hidden entries copies\?\*\*/).replace(/^\*\*Guide claims[^*]*\*\*\s*/, "");

  // ----- Release identity tables (other docs) -----
  const famIdent = tableWith(famDoc, /Release\|ELF, version, PCSX2 CRC/);
  const othIdent = tableWith(othDoc, /Game\|Serial, version/);
  const famRows = tableWith(famDoc, /Release\|Code\|Status\|Seen/).rows;
  const famMaps = Object.fromEntries(
    [...famDoc.matchAll(/^- \*\*([^*]+):\*\*([\s\S]*?)(?=^- \*\*|^- Taikenban|^## )/gm)].map((m) => [m[1].trim(), `**${m[1].trim()}:**${m[2]}`.trim()]),
  );

  // ===== Release factory =====
  const releases = [];
  const addRelease = (r) => {
    r.slug = r.slug ?? slugify(`${regionShort(r.serial)}-${r.serial}`);
    r.region = regionOf(r.serial);
    r.regionShort = regionShort(r.serial);
    uniqueSlugs(r.codes);
    r.counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, r.codes.filter((c) => c.status === s).length]));
    releases.push(r);
    return r;
  };

  const ident = (tbl, rowRe, serial, crc) => {
    const row = tbl.rows.find((r) => rowRe.test(r[0]));
    if (!row) throw new Error(`identity row not found: ${rowRe}`);
    if (!row.join(" ").includes(serial.replace("-", "_").replace(/^(\w{4}_)(\d{3})(\d{2})$/, "$1$2.$3")) && !row.join(" ").includes(serial)) {
      // serial may appear as SLUS_204.36 or SLUS-20436
      const alt = serial.replace("-", "_").replace(/(\d{3})(\d{2})$/, "$1.$2");
      if (!row.join(" ").includes(alt)) throw new Error(`serial ${serial} not in row ${row[0]}`);
    }
    if (!row.join(" ").toUpperCase().includes(crc)) throw new Error(`crc ${crc} not in row ${row[0]}`);
    return row;
  };

  // ----- AC+ US -----
  {
    const pn = parsePnach(read(`${AC}/F233A433.pnach`));
    const R0 = R.reg.release;
    const codes = pn.sections.map((s) => {
      const d = R.derived.get(s.name);
      if (!d) throw new Error(`pnach section without registry record: ${s.name}`);
      if (d.raw_code.join("|") !== s.raw.join("|")) throw new Error(`raw code differs between registry and pnach: ${s.name}`);
      const m = matrix.get(s.name);
      if (!m) throw new Error(`no matrix row: ${s.name}`);
      const v = verification.rows.find((r) => stripMd(r[0]) === s.name);
      const checked = m.checked && m.checked !== "-" ? m.checked : v ? cleanNote(v[2]) : "";
      return makeCode("acplus-us", s, { level: d.evidence_level, status: m.status, checked, regId: d.finding_id });
    });
    // lee4 published codes
    const byFeature = new Map(R.published.map((p) => [p.finding_id, p]));
    for (const p of R.published) {
      const yr = String(p.source_date).slice(0, 4);
      const key = `lee4 ${yr}: ${p.title}`;
      const m = matrix.get(key);
      if (!m) throw new Error(`no matrix row: ${key}`);
      const mate = p.conflicts_with?.[0] ? byFeature.get(p.conflicts_with[0]) : null;
      const sectionName = `${key}`;
      const pnachText =
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
        published: { author: p.source_author, date: String(p.source_date), url: p.source_url, archive: p.source_archive, mirror: p.source_mirror, year: yr },
        mateId: mate ? `lee4-${String(mate.source_date).slice(0, 4)}-${slugify(mate.title)}` : null,
        ops: p.ops,
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
  const jpRule = (title, append) => {
    if (append) return { status: "NOT TESTED", level: "S1", checked: jpAppend };
    const row = (re) => jpRuntime.rows.find((r) => re.test(r[0]));
    if (/^Unlock everything$/.test(title)) {
      const a = row(/^\*\*Unlock everything\*\*$/);
      const b = row(/^Saved with/);
      return { status: "VERIFIED", level: "S4", checked: `${stripMd(a[1])} ${stripMd(b[1])}` };
    }
    if (/^Stage select: all 34/.test(title) || /^Stage select: hidden stages too/.test(title)) {
      const a = row(/Stage select: all 34/);
      return { status: "VERIFIED", level: "S2", checked: stripMd(a[1]) };
    }
    return { status: "INFERRED", level: "S1", checked: jpSingle };
  };
  for (const [serial, crc, file, append, label] of [
    ["SLPM-66965", "61FE9C13", "SLPM-66965_61FE9C13.pnach", false, "JP"],
    ["SLPM-66964", "45D92B79", "SLPM-66964_45D92B79.pnach", true, "JP Append"],
  ]) {
    const pins = R.releasePins.find((p) => p.serial === serial);
    if (!pins || pins.elf_crc !== crc) throw new Error(`release pin mismatch ${serial}`);
    const row = jpIdent.rows.find((r) => r[0].includes(serial));
    const pn = parsePnach(read(`${AC}/jp/${file}`));
    const codes = pn.sections.map((s) => {
      if (!R.derived.has(s.name)) throw new Error(`JP section not in US registry: ${s.name}`);
      return makeCode(serial, s, jpRule(s.name, append));
    });
    addRelease({
      gameId: "acplus",
      slug: `${label.startsWith("JP A") ? "jp-append" : "jp"}-${serial.toLowerCase()}`,
      label,
      serial,
      version: pins.game_version,
      crc,
      elf: { name: row[2].split(",")[0].trim(), sha256: pins.elf_sha256 },
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
    const pn = parsePnach(read(`${X2}/SLUS-20436_913FBFB8.pnach`));
    const v = tableWith(x2Doc, /Code\|Status\|Measured result/).rows;
    const find = (re) => v.find((r) => re.test(stripMd(r[0])));
    const rowFor = (t) => {
      if (/^Unlock everything/.test(t)) return find(/^Unlock everything/);
      if (/^Unlock (Robo-Ky|Kliff|Justice)$/.test(t)) return find(/Robo-Ky \/ Kliff \/ Justice/);
      if (t === "Unlock GG mode") return find(/^Unlock GG mode/);
      if (t === "Unlock all SP colours") return find(/^Unlock all SP colours/);
      if (t === "Unlock all EX characters") return find(/^Unlock all EX characters/);
      if (t === "Unlock SP Sol Badguy") return find(/^Unlock all SP colours/);
      if (t === "Unlock EX Sol Badguy") return find(/^Unlock all EX characters/);
      if (t === "Max play time") return find(/^Max play time/);
      return find(/^Unlock EX \/ SP \(one character\)/);
    };
    const codes = pn.sections.map((s) => {
      const r = rowFor(s.name);
      if (!r) throw new Error(`X2 status row missing for ${s.name}`);
      const st = statusOf(r[1]);
      let checked = stripMd(r[2]);
      const forSol = /for Sol/.test(stripMd(r[1])) && !/Sol Badguy$/.test(s.name) && /all (EX|SP)/.test(s.name);
      if (forSol) checked = `Checked with Sol only. ${checked}`;
      return makeCode("x2", s, { status: st, level: levelOf(r[2]) ?? levelOf(r[1]), checked });
    });
    const row = ident(othIdent, /X2/, "SLUS-20436", "913FBFB8");
    addRelease({
      gameId: "xx",
      slug: "us-slus-20436",
      label: "US X2",
      serial: "SLUS-20436",
      version: "1.00",
      crc: "913FBFB8",
      elf: { name: "SLUS_204.36", sha256: stripMd(row[3]) },
      imageInfo: stripMd(row[4]),
      pnachFile: "SLUS-20436_913FBFB8.pnach",
      pnachText: read(`${X2}/SLUS-20436_913FBFB8.pnach`),
      codes,
      unlock: { kind: "x2" },
    });
  }

  // ----- Family releases (AC US, Slash JP, #Reload KR/JP, GGXX JP) -----
  const famRow = (relRe, codeRe) => famRows.find((r) => relRe.test(stripMd(r[0])) && codeRe.test(stripMd(r[1])));
  const famStatus = (row, over = {}) => {
    const st = statusOf(row[2]) ?? (/prior art/i.test(row[2]) ? "VERIFIED" : "INFERRED");
    const lv = levelOf(row[2]);
    const seen = stripMd(row[3]);
    return { status: st, level: lv, checked: cleanNote(`${stripMd(row[2]).replace(/\*/g, "")}${seen ? ". " + seen : ""}`), ...over };
  };
  const persist = (relRe) => famRow(relRe, /^Persistence/);
  const lastInferred = famRows.find((r) => /#Reload \(Japan\), GGXX/.test(stripMd(r[0])));
  const fam = [
    {
      serial: "SLUS-21652", crc: "A8A76AAC", file: "SLUS-21652_A8A76AAC.pnach", gameId: "ac", label: "US", ver: "1.00", rowRe: /^Accent Core \(US\)/, mapKey: "Accent Core (US)", identRe: /^Accent Core \(US\)/,
      rule: (t, rel) => {
        if (t === "Unlock all EX characters") return famStatus(famRow(rel, /^Unlock all EX/));
        if (t === "Max play time") return famStatus(famRow(rel, /^Max play time/));
        if (t === "Unlock gold/black Sol Badguy" || t === "Unlock gold/black Ky Kiske") return famStatus(famRow(rel, /^Unlock gold\/black, single/), { status: "VERIFIED" });
        if (t === "Unlock all gold and black colours") return famStatus(persist(rel), { status: "VERIFIED" });
        return null;
      },
    },
    {
      serial: "SLPM-66333", crc: "06DE61E0", file: "SLPM-66333_06DE61E0.pnach", gameId: "slash", label: "JP", ver: "1.01", rowRe: /^Slash \(Japan\)/, mapKey: "Slash (Japan)", identRe: /^Slash \(Japan\)/,
      rule: (t, rel) => {
        if (t === "Unlock Kliff and Justice") return famStatus(famRow(rel, /^Unlock Kliff/));
        if (t === "Unlock GG mode and EX characters") return famStatus(famRow(rel, /^Unlock GG mode/));
        return famStatus(persist(rel), { status: "VERIFIED" });
      },
    },
    {
      serial: "SLKA-25070", crc: "90F292F7", file: "SLKA-25070_90F292F7.pnach", gameId: "reload", label: "KR", ver: "1.01", rowRe: /^#Reload \(Korea\)/, mapKey: "#Reload (Korea)", identRe: /^#Reload \(Korea\)/,
      rule: (t, rel) => {
        if (t === "Unlock hidden characters and GG mode") return famStatus(famRow(rel, /^Unlock hidden/));
        if (t === "Unlock all SP colours") return famStatus(famRow(rel, /^SP colour, single/), { status: "VERIFIED" });
        if (t === "Unlock all EX characters") return famStatus(persist(rel), { status: "VERIFIED" });
        return null;
      },
    },
    {
      serial: "SLPS-25261", crc: "21FCC394", file: "SLPS-25261_21FCC394.pnach", gameId: "reload", label: "JP", ver: "1.01", rowRe: /^#Reload \(Japan\)$/, mapKey: "#Reload (Japan)", identRe: /^#Reload \(Japan\)/,
      rule: (t, rel) => (t === "Unlock hidden characters and GG mode" ? famStatus(famRow(rel, /^Unlock hidden/)) : null),
      fallback: lastInferred,
    },
    {
      serial: "SLPS-25184", crc: "4B6DDB6B", file: "SLPS-25184_4B6DDB6B.pnach", gameId: "xx", label: "JP XX", ver: "2.00", rowRe: /^Guilty Gear XX \(Japan\)/, mapKey: "Guilty Gear XX (Japan)", identRe: /^Guilty Gear XX \(Japan\)/,
      rule: (t, rel) => (t === "Unlock Robo-Ky, Kliff, Justice and GG mode" ? famStatus(famRow(rel, /^Unlock Robo-Ky/)) : null),
      fallback: lastInferred,
    },
  ];
  for (const f of fam) {
    const text = read(`${X2}/${f.file}`);
    const pn = parsePnach(text);
    const codes = pn.sections.map((s) => {
      const r = f.rule(s.name, f.rowRe);
      if (r) return makeCode(f.serial, s, r);
      const fb = f.fallback ?? null;
      if (fb) return makeCode(f.serial, s, { status: "INFERRED", level: null, checked: cleanNote(stripMd(fb[3])) });
      return makeCode(f.serial, s, { status: "INFERRED", level: null, checked: "" });
    });
    const row = ident(famIdent, f.identRe, f.serial, f.crc);
    addRelease({
      gameId: f.gameId,
      slug: `${regionShort(f.serial).toLowerCase()}-${f.serial.toLowerCase()}`,
      label: f.label,
      serial: f.serial,
      version: f.ver,
      crc: f.crc,
      elf: { name: row[1].split(",")[0].trim(), sha256: stripMd(row[2]) },
      imageInfo: stripMd(row[3]),
      pnachFile: f.file,
      pnachText: text,
      codes,
      unlock: { kind: "family", mapKey: f.mapKey, rowRe: f.rowRe },
      famName: f.mapKey,
    });
  }

  // ----- X (US): button code + RAM write -----
  const xSec = section(othDoc, "## Guilty Gear X (US): prior art plus a first lab result").replace(
    / One scripted attempt at\s+the button code did not register; the input timing on the title screen still needs work\./,
    "",
  );
  const xPlusSec = section(othDoc, "## Guilty Gear X Plus (JP): password table decoded").replace(
    /,\s+at\s+0x5C8A20\s+\.\.\.\s+0x5C8A60\.\s+A\s+screen\s+routine(?:\s+\(0x[0-9A-F]+\))?\s+shows\s+one\s+of\s+them\s+when\s+a\s+state\s+value\s+\(\+0x40C\)\s+is\s+3\s+\(KDOKBNZY\),\s+11\s+\(ADROPOUT\)\s+or\s+19\s+\(BLACKMAS\)\./,
    ".",
  );
  const isukaSec = section(othDoc, "## Guilty Gear Isuka (US): pinned, not mapped");
  {
    const row = ident(othIdent, /^Guilty Gear X \(US\)/, "SLUS-20287", "861BFB2F");
    const seq = (xSec.match(/\(Down, Right, Right, Up, then Start\)/) || [])[0];
    if (!seq) throw new Error("X title-screen sequence not found");
    const ram = xSec.match(/\*\*0x([0-9A-F]{6}) = (\d)\*\*/);
    if (!ram) throw new Error("X RAM write not found");
    const ramAddr = ram[1].padStart(8, "0");
    const ramVal = ram[2].padStart(8, "0");
    const lab = between(xSec, /- The title-screen code works/, /\n  - With the code, Dizzy/).replace(/^- /, "").replace(/\n\s+/g, " ");
    const codes = [
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
      gameId: "x", slug: "us-slus-20287", label: "US", serial: "SLUS-20287", version: "2.00", crc: "861BFB2F",
      elf: { name: "SLUS_202.87", sha256: stripMd(row[3]) }, imageInfo: stripMd(row[4]), codes, pnachFile: null, pnachText: null,
      unlock: { kind: "x", md: xSec },
    });
  }

  // ----- X Plus (JP): passwords -----
  {
    const row = ident(othIdent, /^Guilty Gear X Plus/, "SLPS-20137", "4191CC06");
    const pwTable = tableWith(xPlusSec, /#\|Password\|Action/);
    const dirTable = tableWith(xPlusSec, /Password\|Direction/);
    const faq = [...xPlusSec.matchAll(/^- `([A-Z0-9]{8})`: ([^;.\n]+)/gm)].map((m) => [m[1], m[2]]);
    const faqMap = new Map(faq);
    const levelNote = between(xPlusSec, /\*\*What the unlock levels do/, null);
    const faqLink = "[skuldnoshinpu's \"Additions FAQ\" on GameFAQs](https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663)";
    const codes = pwTable.rows.map((r) => {
      const pw = stripMd(r[1]);
      const action = stripMd(r[2]);
      const cited = faqMap.has(pw);
      const unlocks = /7IRAKUSA|S2K8A3K1/.test(pw);
      const none = /same path as a wrong password/.test(action);
      return {
        id: `password-${pw.toLowerCase()}`,
        title: `Password ${pw}`,
        group: "Passwords",
        effect: cited ? `${faqMap.get(pw)[0].toUpperCase()}${faqMap.get(pw).slice(1)}.` : none ? "No effect in this build." : pw === "7IRAKUSA" ? "Unlocks Kliff." : "Unlocks Justice.",
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
      gameId: "x", slug: "jp-slps-20137", label: "JP X Plus", serial: "SLPS-20137", version: "1.03", crc: "4191CC06",
      elf: { name: "SLPS_201.37", sha256: stripMd(row[3]) }, imageInfo: stripMd(row[4]), codes, pnachFile: null, pnachText: null,
      unlock: { kind: "xplus", md: xPlusSec, dirTable, levelNote, faqLink },
    });
  }

  // ----- Isuka (US) and Taikenban: pinned only -----
  {
    const row = ident(othIdent, /^Guilty Gear Isuka/, "SLUS-20908", "054DED36");
    addRelease({ gameId: "isuka", slug: "us-slus-20908", label: "US", serial: "SLUS-20908", version: "1.00", crc: "054DED36",
      elf: { name: "SLUS_209.08", sha256: stripMd(row[3]) }, imageInfo: stripMd(row[4]), codes: [], pnachFile: null, pnachText: null,
      unlock: { kind: "isuka", md: isukaSec } });
    const t = famIdent.rows.find((r) => /Taikenban/.test(r[0]));
    addRelease({ gameId: "xx", slug: "jp-slpm-60193", label: "JP Taikenban", serial: "SLPM-60193", version: "1.00", crc: "7CF7B5DA",
      elf: { name: "SLPM_601.93", sha256: stripMd(t[2]) }, imageInfo: stripMd(t[3]), codes: [], pnachFile: null, pnachText: null,
      unlock: { kind: "taikenban", md: famMaps["Taikenban (trial)"] } });
  }

  // Catalog drafts never enter the public model or the downloads list.
  const features = loadCatalog(REPO, releases);
  for (const feature of features) feature.release.codes.push(feature);
  for (const release of releases) {
    release.counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, release.codes.filter((code) => code.status === status).length]));
    release.patchSections = (release.pnachText ? parsePnach(release.pnachText).sections.length : 0)
      + features.filter((feature) => feature.release === release).reduce((n, feature) => n + (feature.artifact?.sectionCount ?? 0), 0);
  }

  // ----- Games -----
  const gameDefs = [
    { id: "x", title: "Guilty Gear X", short: "X" },
    { id: "xx", title: "Guilty Gear XX / X2", short: "XX / X2" },
    { id: "reload", title: "Guilty Gear XX #Reload", short: "#Reload" },
    { id: "slash", title: "Guilty Gear XX Slash", short: "Slash" },
    { id: "ac", title: "Guilty Gear XX Accent Core", short: "AC" },
    { id: "acplus", title: "Guilty Gear XX Accent Core Plus", short: "AC+" },
    { id: "isuka", title: "Guilty Gear Isuka", short: "Isuka" },
  ];
  const games = gameDefs.map((g) => ({
    ...g,
    slug: { x: "guilty-gear-x", xx: "guilty-gear-xx-x2", reload: "guilty-gear-xx-reload", slash: "guilty-gear-xx-slash", ac: "guilty-gear-xx-accent-core", acplus: "guilty-gear-xx-accent-core-plus", isuka: "guilty-gear-isuka" }[g.id],
    releases: releases.filter((r) => r.gameId === g.id),
  }));
  for (const g of games) for (const r of g.releases) { r.game = g; r.url = `/games/${g.slug}/${r.slug}/`; for (const c of r.codes) { c.release = r; c.url = `${r.url}${c.id}/`; } }

  const shared = {
    priorWork, sourcesTable, lee4Where, lee4Tests, masterCode, sideEffect, verdict, playTime, timeSep, stageTable, stageFlags, stageStates,
    fieldMap, quickStart, charactersMd, caveatsMd, howTo, accept, jpDoc, jpRuntime, jpSingle, jpAppend, guideClaims,
    verification, testSetup, famMaps, famRows, x2Doc, famDoc, othDoc, acDoc, evidenceLevels: R.reg.evidence_levels,
    claims: R.claims, registryCount: R.count, commit,
  };
  return { games, releases, shared, GROUPS, features };
}
