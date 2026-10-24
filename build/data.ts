// Reads the cheat docs (read-only) and builds the site model.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseRegistry, parseEvidenceLevel } from "./registry.ts";
import type { DerivedFinding, PublishedFinding, Registry, ReleasePin } from "./registry.ts";
import { countCodes, requireValue } from "./model.ts";
import type {
  CatalogFeature,
  Code,
  CodeDraft,
  CodeFields,
  CodeGroup,
  EvidenceLevel,
  Game,
  GameDefinition,
  GameId,
  LegacyCode,
  ParsedPnach,
  PnachSection,
  Release,
  ReleaseInput,
  Site,
  Shared,
  Status,
  Table,
} from "./model.ts";
import { loadCatalog } from "./catalog.ts";
import { sectionBody, textBetween, tableWith, stripMarkdown, parsePnach, regionName, regionCode, slugify, scrub } from "./lib.ts";

type CodeEvidence = Pick<CodeFields, "status" | "level" | "checked">;
type MatrixEntry = { readonly status: Status; readonly raw: string; readonly level: string | undefined; readonly checked: string };
type EvidenceRule = (title: string, statusRow: RegExp) => CodeEvidence | null;
type FamilyDefinition = {
  readonly serial: string;
  readonly crc: string;
  readonly file: string;
  readonly gameId: GameId;
  readonly label: string;
  readonly version: string;
  readonly rowPattern: RegExp;
  readonly mapKey: string;
  readonly identityPattern: RegExp;
  readonly rule: EvidenceRule;
  readonly fallback?: readonly string[] | undefined;
};
type JapaneseRelease = {
  readonly serial: string;
  readonly crc: string;
  readonly file: string;
  readonly isAppendEdition: boolean;
  readonly label: string;
};

const GAME_DEFINITIONS: readonly GameDefinition[] = [
  { id: "x", title: "Guilty Gear X", short: "X", slug: "guilty-gear-x" },
  { id: "xx", title: "Guilty Gear XX / X2", short: "XX / X2", slug: "guilty-gear-xx-x2" },
  { id: "reload", title: "Guilty Gear XX #Reload", short: "#Reload", slug: "guilty-gear-xx-reload" },
  { id: "slash", title: "Guilty Gear XX Slash", short: "Slash", slug: "guilty-gear-xx-slash" },
  { id: "ac", title: "Guilty Gear XX Accent Core", short: "AC", slug: "guilty-gear-xx-accent-core" },
  { id: "acplus", title: "Guilty Gear XX Accent Core Plus", short: "AC+", slug: "guilty-gear-xx-accent-core-plus" },
  { id: "isuka", title: "Guilty Gear Isuka", short: "Isuka", slug: "guilty-gear-isuka" },
];

/** The cheat docs checkout, from --source or RETRO_REPO; resolved when the site loads, not at import. */
function sourceRepo(): string {
  const sourceArgument: string | null | undefined = process.argv.includes("--source")
    ? process.argv[process.argv.indexOf("--source") + 1]
    : null;
  return requireValue(sourceArgument || process.env["RETRO_REPO"], "Set RETRO_REPO or pass --source <path> to the cheat docs checkout.");
}

const AC_PLUS_DIR: "games/ggacplus-cheats" = "games/ggacplus-cheats";
const X2_DIR: "games/ggx2-cheats" = "games/ggx2-cheats";
const HARDWARE_STATUS: "NOT TESTED" = "NOT TESTED";

function groupFor(title: string): CodeGroup {
  if (/^Unlock everything/i.test(title)) return "Everything";
  if (/^Stage select|^Load any stage/i.test(title)) return "Stages";
  if (/\bEX\b/.test(title) && !/GG mode and EX/.test(title)) return "EX characters";
  if (/gold|black|\bSP\b/i.test(title)) return "Gold, black and SP colours";
  if (/missions|story endings|gallery|play time/i.test(title)) return "Progress";
  return "Characters and modes";
}

function levelOf(cell: string | undefined): EvidenceLevel | null {
  let levelMatch: RegExpMatchArray | null = String(cell).match(/\bS([0-6])\b/);
  return levelMatch ? parseEvidenceLevel(levelMatch[0]) : null;
}

function statusOf(cell: string | undefined): Status {
  const label: string = stripMarkdown(cell).toLowerCase();
  if (label.startsWith("superseded")) return "SUPERSEDED";
  if (label.startsWith("verified")) return "VERIFIED";
  if (label.startsWith("inferred")) return "INFERRED";
  if (label.startsWith("not tested") || label.startsWith("not run")) return "NOT TESTED";
  throw new Error(`Unknown status: ${cell}`);
}

function cleanNote(cell: string | undefined): string {
  return scrub(stripMarkdown(cell))
    .replace(/\s*\([^()]*\.py[^()]*\)/g, "")
    .replace(/^-$/, "")
    .trim();
}

function sourceCommit(repo: string): string {
  return execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

// ---------- code builders ----------

function makeCode(section: PnachSection, extra: Partial<CodeEvidence> & { readonly registryId?: string }): LegacyCode {
  const title: string = section.name;
  return {
    id: slugify(title),
    title,
    group: groupFor(title),
    effect: scrub(section.description),
    raw: section.raw,
    pnach: scrub(section.text),
    author: section.author,
    status: "INFERRED",
    level: null,
    checked: "",
    hardware: HARDWARE_STATUS,
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
  const repo: string = sourceRepo();
  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(repo, relativePath), "utf8").replace(/\r\n/g, "\n");
  }
  const acDoc: string = readSource(`${AC_PLUS_DIR}/CHEATS.md`);
  const x2Doc: string = readSource(`${X2_DIR}/CHEATS.md`);
  const familyDoc: string = readSource(`${X2_DIR}/FAMILY.md`);
  const otherDiscsDoc: string = readSource(`${X2_DIR}/OTHER_DISCS.md`);
  const registry: Registry = parseRegistry(readSource(`${AC_PLUS_DIR}/registry.yaml`));
  const commit: string = sourceCommit(repo);

  // ----- AC+ matrix: status per code title -----
  const matrixDoc: string = textBetween(acDoc, /<!-- MATRIX -->/, /<!-- \/MATRIX -->/);
  const matrix: ReadonlyMap<string, MatrixEntry> = new Map(
    tableWith(matrixDoc, /Code\|Code types\|Status/).rows.map((row: readonly string[]): [string, MatrixEntry] => [
      stripMarkdown(row[0]),
      { status: statusOf(row[2]), raw: stripMarkdown(row[2]), level: row[3], checked: cleanNote(row[4]) },
    ]),
  );
  const verification: Table = tableWith(acDoc, /Code\|Status\|Measured result/);

  const testEnvironment: Registry["metadata"]["test_environment"] = registry.metadata.test_environment;
  const testSetup: ReadonlyArray<readonly [string, string]> = [
    ["Emulator", testEnvironment.emulator],
    ["Starting point", "Fresh save at the main menu"],
    ["Cheat devices", testEnvironment.hardware_devices],
  ];

  // ----- AC+ shared prose -----
  const priorWork: string = textBetween(acDoc, /\*\*Prior work\.\*\*/, /\nThis document adds the following:/);
  const sources: string = sectionBody(acDoc, "## Prior work and sources");
  const sourcesTable: Table = tableWith(sources, /Source\|Author, date/);
  const lee4Writes: Table = tableWith(sources, /lee4 code\|2014/);
  const lee4Tests: Table = tableWith(sources, /2014 \(lee4's post\)/);
  const masterCode: string | undefined = acDoc.match(/master code, `([0-9A-F ]+)`/)?.[1];
  if (!masterCode) throw new Error("master code not found");
  const sideEffect: string = textBetween(sources, /\*\*The SE\/VOICE side effect, explained/, /\*\*Both versions tested/);
  const verdict: string = requireValue(textBetween(sources, /\*\*Verdict: /, null).split("\n\n")[0], "verdict");
  const playTime: Table = tableWith(acDoc, /Play time\|Unlock/);
  const stageSelectPlayTime: string = textBetween(acDoc, /Separately, the stage select grants/, /\n\n/);
  const stageTable: Table = tableWith(sectionBody(acDoc, "## Stage table"), /Stage\|Accent Core/);
  const stageFlags: Table = tableWith(textBetween(acDoc, /<!-- STAGEFLAGS -->/, /<!-- \/STAGEFLAGS -->/), /Entry\|Stage\|Enabled by/);
  const stageStates: Table = tableWith(acDoc, /State\|Selectable entries/);
  const fieldMap: Table = tableWith(acDoc, /Offset\|Size\|Meaning/);
  const quickStart: Table = tableWith(acDoc, /You want\|Enable\|Then/);
  const charactersMd: string = sectionBody(acDoc, "## Characters");
  const caveatsMd: string = sectionBody(acDoc, "## Caveats");
  const howTo: string = sectionBody(acDoc, "## How to use the codes");
  const forcedEntries: string = textBetween(
    acDoc,
    /\*\*Forced-only entries load and play/,
    /\*\*Guide claims, checked against this disc\.\*\*/,
  );
  const jpDoc: string = sectionBody(acDoc, "## Japanese releases (separate findings)");
  const jpRuntime: Table = tableWith(jpDoc, /Test\|Result\|Level/);
  const jpSingleCharacter: string = textBetween(jpDoc, /The single-character codes run on/, /\n\n/).replace(/\n/g, " ");
  const jpAppendEdition: string = scrub(textBetween(jpDoc, /\*\*Append Edition: not run\.\*\*/, /\n\n/).replace(/\n/g, " "));
  const jpIdentity: Table = tableWith(jpDoc, /Release\|Disc \(Redump\)/);
  const guideClaims: string = textBetween(
    acDoc,
    /\*\*Guide claims, checked against this disc\.\*\*/,
    /\*\*Are the hidden entries copies\?\*\*/,
  ).replace(/^\*\*Guide claims[^*]*\*\*\s*/, "");

  // ----- Release identity tables (other docs) -----
  const familyIdentity: Table = tableWith(familyDoc, /Release\|ELF, version, PCSX2 CRC/);
  const otherIdentity: Table = tableWith(otherDiscsDoc, /Game\|Serial, version/);
  const familyRows: ReadonlyArray<readonly string[]> = tableWith(familyDoc, /Release\|Code\|Status\|Seen/).rows;
  const familyMaps: Readonly<Record<string, string>> = Object.fromEntries(
    [...familyDoc.matchAll(/^- \*\*([^*]+):\*\*([\s\S]*?)(?=^- \*\*|^- Taikenban|^## )/gm)].map(
      (familyMatch: RegExpExecArray): [string, string] => [
        requireValue(familyMatch[1], "family name").trim(),
        `**${requireValue(familyMatch[1], "family name").trim()}:**${familyMatch[2]}`.trim(),
      ],
    ),
  );

  // ===== Release factory =====
  let releases: Release[] = [];
  function addRelease(input: ReleaseInput): Release {
    const slug: string = input.slug ?? slugify(`${regionCode(input.serial)}-${input.serial}`);
    const game: GameDefinition = requireValue(
      GAME_DEFINITIONS.find((candidate: GameDefinition): boolean => candidate.id === input.gameId),
      "game definition",
    );
    const url: string = `/games/${game.slug}/${slug}/`;
    let codes: readonly CodeDraft[] = uniqueSlugs(input.codes);
    let release: Release = {
      ...input,
      slug,
      game,
      url,
      region: regionName(input.serial),
      regionCode: regionCode(input.serial),
      counts: countCodes(codes),
      codes: [],
      patchSections: 0,
    };
    release.codes = codes.map((code: CodeDraft): Code => ({ ...code, release, url: `${url}${code.id}/` }));
    releases.push(release);
    return release;
  }

  function identityRow(table: Table, rowPattern: RegExp, serial: string, crc: string): readonly string[] {
    const row: readonly string[] | undefined = table.rows.find((candidate: readonly string[]): boolean =>
      rowPattern.test(requireValue(candidate[0], "row label")),
    );
    if (!row) throw new Error(`identity row not found: ${rowPattern}`);
    if (
      !row.join(" ").includes(serial.replace("-", "_").replace(/^(\w{4}_)(\d{3})(\d{2})$/, "$1$2.$3")) &&
      !row.join(" ").includes(serial)
    ) {
      // serial may appear as SLUS_204.36 or SLUS-20436
      const dottedSerial: string = serial.replace("-", "_").replace(/(\d{3})(\d{2})$/, "$1.$2");
      if (!row.join(" ").includes(dottedSerial)) throw new Error(`serial ${serial} not in row ${requireValue(row[0], "source row field")}`);
    }
    if (!row.join(" ").toUpperCase().includes(crc)) throw new Error(`crc ${crc} not in row ${requireValue(row[0], "source row field")}`);
    return row;
  }

  // ----- AC+ US -----
  {
    const pnach: ParsedPnach = parsePnach(readSource(`${AC_PLUS_DIR}/F233A433.pnach`));
    const pinnedRelease: Registry["metadata"]["release"] = registry.metadata.release;
    let codes: CodeDraft[] = pnach.sections.map((section: PnachSection): LegacyCode => {
      const derived: DerivedFinding | undefined = registry.derived.get(section.name);
      if (!derived) throw new Error(`pnach section without registry record: ${section.name}`);
      if (derived.raw_code.join("|") !== section.raw.join("|"))
        throw new Error(`raw code differs between registry and pnach: ${section.name}`);
      const matrixEntry: MatrixEntry | undefined = matrix.get(section.name);
      if (!matrixEntry) throw new Error(`no matrix row: ${section.name}`);
      const verificationRow: readonly string[] | undefined = verification.rows.find(
        (row: readonly string[]): boolean => stripMarkdown(row[0]) === section.name,
      );
      const checked: string =
        matrixEntry.checked && matrixEntry.checked !== "-" ? matrixEntry.checked : verificationRow ? cleanNote(verificationRow[2]) : "";
      return makeCode(section, { level: derived.evidence_level, status: matrixEntry.status, checked, registryId: derived.finding_id });
    });
    // lee4 published codes
    let findingsById: Map<string, PublishedFinding> = new Map(
      registry.published.map((finding: PublishedFinding): [string, PublishedFinding] => [finding.finding_id, finding]),
    );
    for (const finding of registry.published) {
      const year: string = String(finding.source_date).slice(0, 4);
      const key: string = `lee4 ${year}: ${finding.title}`;
      const matrixEntry: MatrixEntry | undefined = matrix.get(key);
      if (!matrixEntry) throw new Error(`no matrix row: ${key}`);
      const counterpart: PublishedFinding | null | undefined = finding.conflicts_with?.[0]
        ? findingsById.get(finding.conflicts_with[0])
        : null;
      const pnachText: string =
        `[${key}]\nauthor=lee4\n` +
        (year === "2009" ? "comment=Superseded: every save address is 8 bytes below the 2014 version.\n" : "") +
        finding.generated_pnach.join("\n");
      codes.push({
        id: `lee4-${year}-${slugify(finding.title)}`,
        title: key,
        shortTitle: finding.title,
        group: year === "2014" ? "lee4, 2014" : "lee4, 2009 (superseded)",
        effect: scrub(finding.provenance_note),
        raw: finding.raw_code,
        pnach: pnachText,
        author: finding.source_author,
        status: matrixEntry.status,
        statusNote: matrixEntry.raw.replace(/\*\*/g, ""),
        level: finding.evidence_level,
        checked: matrixEntry.checked,
        hardware: HARDWARE_STATUS,
        published: {
          author: finding.source_author,
          date: String(finding.source_date),
          url: finding.source_url,
          ...(finding.source_archive === undefined ? {} : { archive: finding.source_archive }),
          ...(finding.source_mirror === undefined ? {} : { mirror: finding.source_mirror }),
          year,
        },
        counterpartId: counterpart ? `lee4-${String(counterpart.source_date).slice(0, 4)}-${slugify(counterpart.title)}` : null,
      });
    }
    addRelease({
      gameId: "acplus",
      slug: "us-slus-21847",
      label: "US",
      serial: "SLUS-21847",
      version: "1.00",
      crc: pinnedRelease.elf.pcsx2_crc,
      elf: { name: pinnedRelease.elf.name, size: pinnedRelease.elf.size, sha256: pinnedRelease.elf.sha256 },
      disc: {
        redump: pinnedRelease.disc.redump_url,
        crc32: pinnedRelease.disc.crc32,
        sha1: pinnedRelease.disc.sha1,
        size: pinnedRelease.disc.size,
        date: pinnedRelease.disc.exe_date,
      },
      pnachFile: "F233A433.pnach",
      pnachText: scrub(readSource(`${AC_PLUS_DIR}/F233A433.pnach`)),
      codes,
      hasLee4: true,
      unlock: { kind: "acplus" },
    });
  }

  // ----- AC+ JP / Append -----
  function japaneseEvidence(title: string, isAppendEdition: boolean): CodeEvidence {
    if (isAppendEdition) return { status: "NOT TESTED", level: "S1", checked: jpAppendEdition };
    function runtimeRow(titlePattern: RegExp): readonly string[] {
      return requireValue(
        jpRuntime.rows.find((row: readonly string[]): boolean => titlePattern.test(requireValue(row[0], "JP row title"))),
        "JP runtime row",
      );
    }
    if (/^Unlock everything$/.test(title)) {
      const unlockRow: readonly string[] = runtimeRow(/^\*\*Unlock everything\*\*$/);
      const savedRow: readonly string[] = runtimeRow(/^Saved with/);
      return { status: "VERIFIED", level: "S4", checked: `${stripMarkdown(unlockRow[1])} ${stripMarkdown(savedRow[1])}` };
    }
    if (/^Stage select: all 34/.test(title) || /^Stage select: hidden stages too/.test(title)) {
      const stageRow: readonly string[] = runtimeRow(/Stage select: all 34/);
      return { status: "VERIFIED", level: "S2", checked: stripMarkdown(stageRow[1]) };
    }
    return { status: "INFERRED", level: "S1", checked: jpSingleCharacter };
  }
  const japaneseReleases: readonly JapaneseRelease[] = [
    { serial: "SLPM-66965", crc: "61FE9C13", file: "SLPM-66965_61FE9C13.pnach", isAppendEdition: false, label: "JP" },
    { serial: "SLPM-66964", crc: "45D92B79", file: "SLPM-66964_45D92B79.pnach", isAppendEdition: true, label: "JP Append" },
  ];
  for (const { serial, crc, file, isAppendEdition, label } of japaneseReleases) {
    const pin: ReleasePin | undefined = registry.releasePins.find((candidate: ReleasePin): boolean => candidate.serial === serial);
    if (!pin || pin.elf_crc !== crc) throw new Error(`release pin mismatch ${serial}`);
    const row: readonly string[] = requireValue(
      jpIdentity.rows.find((candidate: readonly string[]): boolean => requireValue(candidate[0], "release serial").includes(serial)),
      "JP identity",
    );
    const pnach: ParsedPnach = parsePnach(readSource(`${AC_PLUS_DIR}/jp/${file}`));
    let codes: CodeDraft[] = pnach.sections.map((section: PnachSection): LegacyCode => {
      if (!registry.derived.has(section.name)) throw new Error(`JP section not in US registry: ${section.name}`);
      return makeCode(section, japaneseEvidence(section.name, isAppendEdition));
    });
    addRelease({
      gameId: "acplus",
      slug: `${label.startsWith("JP A") ? "jp-append" : "jp"}-${serial.toLowerCase()}`,
      label,
      serial,
      version: pin.game_version,
      crc,
      elf: { name: requireValue(requireValue(row[2], "source row field").split(",")[0], "ELF name").trim(), sha256: pin.elf_sha256 },
      disc: { redump: `http://redump.org/disc/${pin.redump_id}/`, crc32: pin.disc_crc32, sha1: pin.disc_sha1 },
      pnachFile: file,
      pnachText: readSource(`${AC_PLUS_DIR}/jp/${file}`),
      codes,
      unlock: { kind: "acplus", isJapanese: true, isAppendEdition },
      note: isAppendEdition ? jpAppendEdition : null,
    });
  }

  // ----- X2 US -----
  {
    const pnach: ParsedPnach = parsePnach(readSource(`${X2_DIR}/SLUS-20436_913FBFB8.pnach`));
    const verificationRows: ReadonlyArray<readonly string[]> = tableWith(x2Doc, /Code\|Status\|Measured result/).rows;
    function findRow(titlePattern: RegExp): readonly string[] | undefined {
      return verificationRows.find((row: readonly string[]): boolean => titlePattern.test(stripMarkdown(row[0])));
    }
    function rowFor(title: string): readonly string[] | undefined {
      if (/^Unlock everything/.test(title)) return findRow(/^Unlock everything/);
      if (/^Unlock (Robo-Ky|Kliff|Justice)$/.test(title)) return findRow(/Robo-Ky \/ Kliff \/ Justice/);
      if (title === "Unlock GG mode") return findRow(/^Unlock GG mode/);
      if (title === "Unlock all SP colours") return findRow(/^Unlock all SP colours/);
      if (title === "Unlock all EX characters") return findRow(/^Unlock all EX characters/);
      if (title === "Unlock SP Sol Badguy") return findRow(/^Unlock all SP colours/);
      if (title === "Unlock EX Sol Badguy") return findRow(/^Unlock all EX characters/);
      if (title === "Max play time") return findRow(/^Max play time/);
      return findRow(/^Unlock EX \/ SP \(one character\)/);
    }
    let codes: CodeDraft[] = pnach.sections.map((section: PnachSection): LegacyCode => {
      const row: readonly string[] | undefined = rowFor(section.name);
      if (!row) throw new Error(`X2 status row missing for ${section.name}`);
      const status: Status = statusOf(row[1]);
      let checked: string = stripMarkdown(row[2]);
      const isCheckedWithSolOnly: boolean =
        /for Sol/.test(stripMarkdown(row[1])) && !/Sol Badguy$/.test(section.name) && /all (EX|SP)/.test(section.name);
      if (isCheckedWithSolOnly) checked = `Checked with Sol only. ${checked}`;
      return makeCode(section, { status, level: levelOf(row[2]) ?? levelOf(row[1]), checked });
    });
    const row: readonly string[] = identityRow(otherIdentity, /X2/, "SLUS-20436", "913FBFB8");
    addRelease({
      gameId: "xx",
      slug: "us-slus-20436",
      label: "US X2",
      serial: "SLUS-20436",
      version: "1.00",
      crc: "913FBFB8",
      elf: { name: "SLUS_204.36", sha256: stripMarkdown(requireValue(row[3], "source row field")) },
      imageInfo: stripMarkdown(requireValue(row[4], "source row field")),
      pnachFile: "SLUS-20436_913FBFB8.pnach",
      pnachText: readSource(`${X2_DIR}/SLUS-20436_913FBFB8.pnach`),
      codes,
      unlock: { kind: "x2" },
    });
  }

  // ----- Family releases (AC US, Slash JP, #Reload KR/JP, GGXX JP) -----
  function familyRow(releasePattern: RegExp, codePattern: RegExp): readonly string[] {
    return requireValue(
      familyRows.find(
        (row: readonly string[]): boolean => releasePattern.test(stripMarkdown(row[0])) && codePattern.test(stripMarkdown(row[1])),
      ),
      "family status row",
    );
  }
  function familyEvidence(row: readonly string[], overrides: Partial<CodeEvidence> = {}): CodeEvidence {
    const status: Status = /prior art/i.test(requireValue(row[2], "source row field")) ? "VERIFIED" : statusOf(row[2]);
    const level: EvidenceLevel | null = levelOf(requireValue(row[2], "source row field"));
    const seen: string = stripMarkdown(requireValue(row[3], "source row field"));
    return {
      status,
      level,
      checked: cleanNote(`${stripMarkdown(requireValue(row[2], "source row field")).replace(/\*/g, "")}${seen ? ". " + seen : ""}`),
      ...overrides,
    };
  }
  function persistenceRow(releasePattern: RegExp): readonly string[] {
    return familyRow(releasePattern, /^Persistence/);
  }
  const lastInferred: readonly string[] | undefined = familyRows.find((row: readonly string[]): boolean =>
    /#Reload \(Japan\), GGXX/.test(stripMarkdown(row[0])),
  );
  let families: readonly FamilyDefinition[] = [
    {
      serial: "SLUS-21652",
      crc: "A8A76AAC",
      file: "SLUS-21652_A8A76AAC.pnach",
      gameId: "ac",
      label: "US",
      version: "1.00",
      rowPattern: /^Accent Core \(US\)/,
      mapKey: "Accent Core (US)",
      identityPattern: /^Accent Core \(US\)/,
      rule: (title: string, statusRow: RegExp): CodeEvidence | null => {
        if (title === "Unlock all EX characters") return familyEvidence(familyRow(statusRow, /^Unlock all EX/));
        if (title === "Max play time") return familyEvidence(familyRow(statusRow, /^Max play time/));
        if (title === "Unlock gold/black Sol Badguy" || title === "Unlock gold/black Ky Kiske")
          return familyEvidence(familyRow(statusRow, /^Unlock gold\/black, single/), { status: "VERIFIED" });
        if (title === "Unlock all gold and black colours") return familyEvidence(persistenceRow(statusRow), { status: "VERIFIED" });
        return null;
      },
    },
    {
      serial: "SLPM-66333",
      crc: "06DE61E0",
      file: "SLPM-66333_06DE61E0.pnach",
      gameId: "slash",
      label: "JP",
      version: "1.01",
      rowPattern: /^Slash \(Japan\)/,
      mapKey: "Slash (Japan)",
      identityPattern: /^Slash \(Japan\)/,
      rule: (title: string, statusRow: RegExp): CodeEvidence => {
        if (title === "Unlock Kliff and Justice") return familyEvidence(familyRow(statusRow, /^Unlock Kliff/));
        if (title === "Unlock GG mode and EX characters") return familyEvidence(familyRow(statusRow, /^Unlock GG mode/));
        return familyEvidence(persistenceRow(statusRow), { status: "VERIFIED" });
      },
    },
    {
      serial: "SLKA-25070",
      crc: "90F292F7",
      file: "SLKA-25070_90F292F7.pnach",
      gameId: "reload",
      label: "KR",
      version: "1.01",
      rowPattern: /^#Reload \(Korea\)/,
      mapKey: "#Reload (Korea)",
      identityPattern: /^#Reload \(Korea\)/,
      rule: (title: string, statusRow: RegExp): CodeEvidence | null => {
        if (title === "Unlock hidden characters and GG mode") return familyEvidence(familyRow(statusRow, /^Unlock hidden/));
        if (title === "Unlock all SP colours") return familyEvidence(familyRow(statusRow, /^SP colour, single/), { status: "VERIFIED" });
        if (title === "Unlock all EX characters") return familyEvidence(persistenceRow(statusRow), { status: "VERIFIED" });
        return null;
      },
    },
    {
      serial: "SLPS-25261",
      crc: "21FCC394",
      file: "SLPS-25261_21FCC394.pnach",
      gameId: "reload",
      label: "JP",
      version: "1.01",
      rowPattern: /^#Reload \(Japan\)$/,
      mapKey: "#Reload (Japan)",
      identityPattern: /^#Reload \(Japan\)/,
      rule: (title: string, statusRow: RegExp): CodeEvidence | null =>
        title === "Unlock hidden characters and GG mode" ? familyEvidence(familyRow(statusRow, /^Unlock hidden/)) : null,
      fallback: lastInferred,
    },
    {
      serial: "SLPS-25184",
      crc: "4B6DDB6B",
      file: "SLPS-25184_4B6DDB6B.pnach",
      gameId: "xx",
      label: "JP XX",
      version: "2.00",
      rowPattern: /^Guilty Gear XX \(Japan\)/,
      mapKey: "Guilty Gear XX (Japan)",
      identityPattern: /^Guilty Gear XX \(Japan\)/,
      rule: (title: string, statusRow: RegExp): CodeEvidence | null =>
        title === "Unlock Robo-Ky, Kliff, Justice and GG mode" ? familyEvidence(familyRow(statusRow, /^Unlock Robo-Ky/)) : null,
      fallback: lastInferred,
    },
  ];
  for (let family of families) {
    const pnachText: string = readSource(`${X2_DIR}/${family.file}`);
    const pnach: ParsedPnach = parsePnach(pnachText);
    let codes: CodeDraft[] = pnach.sections.map((section: PnachSection): LegacyCode => {
      const evidence: CodeEvidence | null = family.rule(section.name, family.rowPattern);
      if (evidence) return makeCode(section, evidence);
      const fallback: readonly string[] | null = family.fallback ?? null;
      if (fallback) return makeCode(section, { status: "INFERRED", level: null, checked: cleanNote(stripMarkdown(fallback[3])) });
      return makeCode(section, { status: "INFERRED", level: null, checked: "" });
    });
    const row: readonly string[] = identityRow(familyIdentity, family.identityPattern, family.serial, family.crc);
    addRelease({
      gameId: family.gameId,
      slug: `${regionCode(family.serial).toLowerCase()}-${family.serial.toLowerCase()}`,
      label: family.label,
      serial: family.serial,
      version: family.version,
      crc: family.crc,
      elf: {
        name: requireValue(requireValue(row[1], "source row field").split(",")[0], "ELF name").trim(),
        sha256: stripMarkdown(requireValue(row[2], "source row field")),
      },
      imageInfo: stripMarkdown(requireValue(row[3], "source row field")),
      pnachFile: family.file,
      pnachText,
      codes,
      unlock: { kind: "family", mapKey: family.mapKey, rowPattern: family.rowPattern },
      familyName: family.mapKey,
    });
  }

  // ----- X (US): button code + RAM write -----
  const xSection: string = sectionBody(otherDiscsDoc, "## Guilty Gear X (US): prior art plus a first lab result").replace(
    / One scripted attempt at\s+the button code did not register; the input timing on the title screen still needs work\./,
    "",
  );
  const xPlusSection: string = sectionBody(otherDiscsDoc, "## Guilty Gear X Plus (JP): password table decoded").replace(
    /,\s+at\s+0x5C8A20\s+\.\.\.\s+0x5C8A60\.\s+A\s+screen\s+routine(?:\s+\(0x[0-9A-F]+\))?\s+shows\s+one\s+of\s+them\s+when\s+a\s+state\s+value\s+\(\+0x40C\)\s+is\s+3\s+\(KDOKBNZY\),\s+11\s+\(ADROPOUT\)\s+or\s+19\s+\(BLACKMAS\)\./,
    ".",
  );
  const isukaSection: string = sectionBody(otherDiscsDoc, "## Guilty Gear Isuka (US): pinned, not mapped");
  {
    const row: readonly string[] = identityRow(otherIdentity, /^Guilty Gear X \(US\)/, "SLUS-20287", "861BFB2F");
    const buttonSequence: string | undefined = xSection.match(/\(Down, Right, Right, Up, then Start\)/)?.[0];
    if (!buttonSequence) throw new Error("X title-screen sequence not found");
    let ramWrite: RegExpMatchArray | null = xSection.match(/\*\*0x([0-9A-F]{6}) = (\d)\*\*/);
    if (!ramWrite) throw new Error("X RAM write not found");
    const ramAddress: string = requireValue(ramWrite[1], "source row field").padStart(8, "0");
    const ramValue: string = requireValue(ramWrite[2], "source row field").padStart(8, "0");
    const labResult: string = textBetween(xSection, /- The title-screen code works/, /\n  - With the code, Dizzy/)
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
        checked: `${labResult} Community-documented code; see the credits for sources.`,
        hardware: HARDWARE_STATUS,
        inputNote: "Enter it while PRESS START BUTTON is showing: 20-frame presses, 60 frames apart.",
      },
      {
        id: "dizzy-and-testament-ram",
        title: "Dizzy and Testament (memory write)",
        group: "Characters and modes",
        effect: "Dizzy and Testament on the select grid. The screen is pixel-identical to the one the title-screen code gives.",
        raw: [`${ramAddress} ${ramValue}`],
        pnach: `[Dizzy and Testament (memory write)]\npatch=1,EE,${ramAddress},extended,${ramValue}`,
        status: "VERIFIED",
        level: "S2",
        checked: "Found by diffing RAM against two code-free cold boots. Not yet checked: whether it is saved to the memory card.",
        hardware: HARDWARE_STATUS,
      },
    ];
    addRelease({
      gameId: "x",
      slug: "us-slus-20287",
      label: "US",
      serial: "SLUS-20287",
      version: "2.00",
      crc: "861BFB2F",
      elf: { name: "SLUS_202.87", sha256: stripMarkdown(requireValue(row[3], "source row field")) },
      imageInfo: stripMarkdown(requireValue(row[4], "source row field")),
      codes,
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "x", markdown: xSection },
    });
  }

  // ----- X Plus (JP): passwords -----
  {
    const row: readonly string[] = identityRow(otherIdentity, /^Guilty Gear X Plus/, "SLPS-20137", "4191CC06");
    const passwordTable: Table = tableWith(xPlusSection, /#\|Password\|Action/);
    const directionTable: Table = tableWith(xPlusSection, /Password\|Direction/);
    const faqEntries: ReadonlyArray<readonly [string, string]> = [...xPlusSection.matchAll(/^- `([A-Z0-9]{8})`: ([^;.\n]+)/gm)].map(
      (passwordMatch: RegExpMatchArray): readonly [string, string] => [
        requireValue(passwordMatch[1], "password"),
        requireValue(passwordMatch[2], "password description"),
      ],
    );
    const faqDescriptions: ReadonlyMap<string, string> = new Map(faqEntries);
    const levelNote: string = textBetween(xPlusSection, /\*\*What the unlock levels do/, null);
    const faqLink: '[skuldnoshinpu\'s "Additions FAQ" on GameFAQs](https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663)' =
      '[skuldnoshinpu\'s "Additions FAQ" on GameFAQs](https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663)';
    const codes: readonly LegacyCode[] = passwordTable.rows.map((passwordRow: readonly string[]): LegacyCode => {
      const password: string = stripMarkdown(passwordRow[1]);
      const action: string = stripMarkdown(passwordRow[2]);
      const isCited: boolean = faqDescriptions.has(password);
      const hasNoEffect: boolean = /same path as a wrong password/.test(action);
      return {
        id: `password-${password.toLowerCase()}`,
        title: `Password ${password}`,
        group: "Passwords",
        effect: isCited
          ? `${requireValue(faqDescriptions.get(password), "password description").charAt(0).toUpperCase()}${requireValue(faqDescriptions.get(password), "password description").slice(1)}.`
          : hasNoEffect
            ? "No effect in this build."
            : password === "7IRAKUSA"
              ? "Unlocks Kliff."
              : "Unlocks Justice.",
        raw: [password],
        rawKind: "password",
        pnach: null,
        status: "INFERRED",
        level: "S1",
        checked: isCited
          ? `Listed in the community FAQ and present in the executable's password table. ${action}.`
          : hasNoEffect
            ? `Present in the executable's password table; ${action}.`
            : `Not found in English or Japanese searches. Found in the executable's password table: ${action}. The level it sets was tested with a memory write (S2); the password was not typed in.`,
        credit: isCited ? faqLink : null,
        hardware: HARDWARE_STATUS,
      };
    });
    addRelease({
      gameId: "x",
      slug: "jp-slps-20137",
      label: "JP X Plus",
      serial: "SLPS-20137",
      version: "1.03",
      crc: "4191CC06",
      elf: { name: "SLPS_201.37", sha256: stripMarkdown(requireValue(row[3], "source row field")) },
      imageInfo: stripMarkdown(requireValue(row[4], "source row field")),
      codes,
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "xplus", markdown: xPlusSection, directionTable, levelNote, faqLink },
    });
  }

  // ----- Isuka (US) and Taikenban: pinned only -----
  {
    const row: readonly string[] = identityRow(otherIdentity, /^Guilty Gear Isuka/, "SLUS-20908", "054DED36");
    addRelease({
      gameId: "isuka",
      slug: "us-slus-20908",
      label: "US",
      serial: "SLUS-20908",
      version: "1.00",
      crc: "054DED36",
      elf: { name: "SLUS_209.08", sha256: stripMarkdown(requireValue(row[3], "source row field")) },
      imageInfo: stripMarkdown(requireValue(row[4], "source row field")),
      codes: [],
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "isuka", markdown: isukaSection },
    });
    const trialRow: readonly string[] = requireValue(
      familyIdentity.rows.find((candidate: readonly string[]): boolean => /Taikenban/.test(requireValue(candidate[0], "trial release"))),
      "trial identity",
    );
    addRelease({
      gameId: "xx",
      slug: "jp-slpm-60193",
      label: "JP Taikenban",
      serial: "SLPM-60193",
      version: "1.00",
      crc: "7CF7B5DA",
      elf: { name: "SLPM_601.93", sha256: stripMarkdown(requireValue(trialRow[2], "source row field")) },
      imageInfo: stripMarkdown(requireValue(trialRow[3], "source row field")),
      codes: [],
      pnachFile: null,
      pnachText: null,
      unlock: { kind: "taikenban", markdown: requireValue(familyMaps["Taikenban (trial)"], "trial description") },
    });
  }

  // Catalog drafts never enter the public model or the downloads list.
  let features: CatalogFeature[] = loadCatalog(repo, releases);
  for (let feature of features) feature.release.codes.push(feature);
  for (let release of releases) {
    release.counts = countCodes(release.codes);
    release.patchSections =
      (release.pnachText ? parsePnach(release.pnachText).sections.length : 0) +
      features
        .filter((feature: CatalogFeature): boolean => feature.release === release)
        .reduce((count: number, feature: CatalogFeature): number => count + (feature.artifact?.sectionCount ?? 0), 0);
  }

  // ----- Games -----
  let games: readonly Game[] = GAME_DEFINITIONS.map(
    (game: GameDefinition): Game => ({ ...game, releases: releases.filter((release: Release): boolean => release.gameId === game.id) }),
  );

  const shared: Shared = {
    priorWork,
    sourcesTable,
    lee4Writes,
    lee4Tests,
    masterCode,
    sideEffect,
    verdict,
    playTime,
    stageSelectPlayTime,
    stageTable,
    stageFlags,
    stageStates,
    fieldMap,
    quickStart,
    charactersMd,
    caveatsMd,
    howTo,
    forcedEntries,
    jpDoc,
    jpRuntime,
    jpSingleCharacter,
    jpAppendEdition,
    guideClaims,
    verification,
    testSetup,
    familyMaps,
    familyRows,
    x2Doc,
    familyDoc,
    otherDiscsDoc,
    acDoc,
    evidenceLevels: registry.metadata.evidence_levels,
    claims: registry.claims,
    registryCount: registry.count,
    commit,
  };
  return { games, releases, shared, features, built: "", priorMap: new Map() };
}
