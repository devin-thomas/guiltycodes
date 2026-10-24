import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { loadCatalog, CATALOG_PATH } from "../build/catalog.ts";
import { loadSite } from "../build/data.ts";
import { codePage, releasePage, sheetPage } from "../build/render.ts";
import type { PageSite } from "../build/render.ts";
import { parseSearch } from "../src/search.ts";
import type { SearchEntry } from "../src/search.ts";
import { parseArray, parseNumber, parseRecord, parseText } from "../build/validate.ts";
import type { CatalogFeature, Code, Release, Site } from "../build/model.ts";

// Catalog JSON as a test writes it to disk. Tests set invalid values on purpose, so the fields are as loose as the file format.
type ReleaseIdentity = { serial: string; crc: string; version: string };
type PinFixture = { path: string; sha256: string };
type FeatureFixture = {
  id: string;
  title: string;
  kind: string;
  category: string;
  publication: string;
  release: ReleaseIdentity;
  source: PinFixture & { revision: string };
  evidence: { status: string; level: string; result: string; testedBuild: string };
  controls: string[];
  dependencies: string[];
  conflicts: string[];
  lifecycle: { enable: string; disable: string; reset?: string; persistence: string };
  instructions?: unknown;
  raw?: string[];
  artifact?: PinFixture;
  compatibilityNotes?: string[];
};
type DraftFixture = { readonly id: string; readonly publication: "draft" };
type CatalogFixture = {
  readonly repo: string;
  readonly release: Release;
  readonly feature: FeatureFixture;
  readonly writeCatalog: (features: ReadonlyArray<FeatureFixture | DraftFixture>) => void;
  readonly writeFile: (file: string, bytes: string) => void;
  readonly git: (...args: readonly string[]) => string;
};
type RejectionCase = { readonly name: string; readonly mutate: (feature: FeatureFixture) => void; readonly message: RegExp };
type PnachIndexEntry = {
  readonly file: string;
  readonly featureId: string | null;
  readonly featurePages: number;
  readonly patchSections: number;
};

const EVIDENCE_PATH: "games/example/EVIDENCE.md" = "games/example/EVIDENCE.md";
const ARTIFACT_PATH: "games/guiltycodes/artifacts/module.pnach" = "games/guiltycodes/artifacts/module.pnach";
const ARTIFACT_TEXT: string =
  "gametitle=Example [SLUS-21847] (F233A433)\n\n[Engine]\npatch=1,EE,20123450,extended,00000001\n\n[Controls]\npatch=0,EE,20123454,extended,00000002\n";
const DRAFT: DraftFixture = { id: "unfinished", publication: "draft" };
const COMMIT_IDENTITY: readonly string[] = [
  "-c",
  "user.name=Catalog test",
  "-c",
  "user.email=catalog@example.test",
  "-c",
  "commit.gpgsign=false",
];

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactPin(text: string = ARTIFACT_TEXT): PinFixture {
  return { path: ARTIFACT_PATH, sha256: sha256(text) };
}

function releaseFixture(): Release {
  return {
    gameId: "acplus",
    label: "US",
    serial: "SLUS-21847",
    version: "1.00",
    crc: "F233A433",
    pnachFile: null,
    pnachText: null,
    unlock: { kind: "acplus" },
    slug: "us-slus-21847",
    region: "North America (NTSC-U)",
    regionCode: "US",
    codes: [],
    counts: { VERIFIED: 0, INFERRED: 0, "NOT TESTED": 0, SUPERSEDED: 0 },
    patchSections: 0,
    game: { id: "acplus", title: "Fixture", short: "Fixture", slug: "fixture" },
    url: "/games/fixture/us/",
  };
}

function fixture(context: TestContext): CatalogFixture {
  const repo: string = fs.mkdtempSync(path.join(os.tmpdir(), "guiltycodes-catalog-"));
  context.after((): void => fs.rmSync(repo, { force: true, recursive: true }));
  function git(...args: readonly string[]): string {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  }
  function writeFile(file: string, bytes: string): void {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), bytes);
  }
  git("init", "-b", "main");
  writeFile(EVIDENCE_PATH, "# Runtime evidence\nObserved on a disposable save.\n");
  writeFile(ARTIFACT_PATH, ARTIFACT_TEXT);
  git("add", "games");
  git(...COMMIT_IDENTITY, "commit", "-m", "Pin fixture evidence");
  const revision: string = git("rev-parse", "HEAD").trim();
  let release: Release = releaseFixture();
  let feature: FeatureFixture = {
    id: "training-controls",
    title: "Training controls",
    kind: "native-tip",
    category: "Training",
    publication: "published",
    release: { serial: release.serial, crc: release.crc, version: release.version },
    source: { revision, path: EVIDENCE_PATH, sha256: sha256(fs.readFileSync(path.join(repo, EVIDENCE_PATH))) },
    evidence: { status: "VERIFIED", level: "S2", result: "Observed training controls.", testedBuild: "SLUS-21847@1.00/F233A433" },
    controls: ["Pause, then select Training"],
    dependencies: [],
    conflicts: [],
    lifecycle: { enable: "Open training", disable: "Leave training", reset: "Restart", persistence: "None" },
    instructions: ["Open the training menu."],
  };
  function writeCatalog(features: ReadonlyArray<FeatureFixture | DraftFixture>): void {
    writeFile(`${CATALOG_PATH}/example.json`, JSON.stringify({ schemaVersion: 1, features }));
  }
  return { repo, release, feature, writeCatalog, writeFile, git };
}

/** Commits the artifact as it is now and pins the feature's evidence to that commit. */
function pinArtifactCommit(catalog: CatalogFixture, message: string): void {
  catalog.git("add", "games/guiltycodes/artifacts");
  catalog.git(...COMMIT_IDENTITY, "commit", "-m", message);
  catalog.feature.source.revision = catalog.git("rev-parse", "HEAD").trim();
}

function requireArtifactText(feature: CatalogFeature | undefined): string {
  let text: string | Uint8Array | undefined = feature?.artifact?.text;
  if (text === undefined) return assert.fail("expected a feature with an artifact");
  return text.toString();
}

function parsePnachIndex(value: unknown): readonly PnachIndexEntry[] {
  return parseArray(value, "pnach index").map((item: unknown): PnachIndexEntry => {
    let entry: Record<string, unknown> = parseRecord(item, "pnach index entry");
    return {
      file: parseText(entry["file"], "file"),
      featureId: entry["featureId"] === null ? null : parseText(entry["featureId"], "featureId"),
      featurePages: parseNumber(entry["featurePages"], "featurePages"),
      patchSections: parseNumber(entry["patchSections"], "patchSections"),
    };
  });
}

function emptyPageSite(): PageSite {
  return { games: [], priorMap: new Map(), built: "2026-10-22" };
}

test("accepts native tips, raw codes and intact multi-section modules without flattening", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  let simple: FeatureFixture = { ...catalog.feature, id: "hud-off", kind: "simple-code", raw: ["20123450 00000001"] };
  let compiled: FeatureFixture = {
    ...catalog.feature,
    id: "camera",
    kind: "compiled-module",
    category: "Presentation",
    dependencies: ["hud-off"],
    artifact: artifactPin(),
  };
  catalog.writeCatalog([catalog.feature, simple, compiled, DRAFT]);
  let entries: readonly CatalogFeature[] = loadCatalog(catalog.repo, [catalog.release]);
  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.artifact, null);
  assert.equal(entries[1]?.artifact?.sectionCount, 1);
  assert.equal(entries[2]?.artifact?.sectionCount, 2);
  assert.equal(requireArtifactText(entries[2]), ARTIFACT_TEXT);
  assert.deepEqual(entries[2]?.raw, []);
  assert.equal(entries[2]?.artifact?.sha256, sha256(requireArtifactText(entries[2])));
});

const ARTIFACT_KINDS: readonly string[] = ["simple-code", "compiled-module"];
const INVALID_INSTRUCTIONS: readonly unknown[] = ["not an array", [], [""]];
for (const kind of ARTIFACT_KINDS) {
  for (const instructions of INVALID_INSTRUCTIONS) {
    test(`${kind} rejects invalid optional instructions ${JSON.stringify(instructions)}`, (context: TestContext): void => {
      let catalog: CatalogFixture = fixture(context);
      catalog.feature.kind = kind;
      catalog.feature.instructions = instructions;
      if (kind === "simple-code") catalog.feature.raw = ["20123450 00000001"];
      else catalog.feature.artifact = artifactPin();
      catalog.writeCatalog([catalog.feature]);
      assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /instructions/);
    });
  }
}

test("compiled setup instructions render publicly and native instructions appear only once", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  catalog.feature.kind = "compiled-module";
  catalog.feature.artifact = artifactPin();
  catalog.feature.instructions = [
    "VENOM 640 / HUNTER: Gold Venom, FIXED CPU 32.",
    "SOL 960 / LIFE REC: EXP Up, Hunter, Life Recovery, in that order.",
  ];
  catalog.writeCatalog([catalog.feature]);
  let [feature]: readonly CatalogFeature[] = loadCatalog(catalog.repo, [catalog.release]);
  if (feature === undefined) return assert.fail("expected one catalog feature");
  catalog.release.codes.push(feature);
  let site: PageSite = emptyPageSite();
  const compiled: string = codePage(feature, site, {});
  let nativeTip: Code = { ...feature, kind: "native-tip", artifact: null };
  const native: string = codePage(nativeTip, site, {});
  assert.match(compiled, /Setup instructions/);
  assert.match(compiled, /Tools &gt; Open Data Directory/);
  assert.match(compiled, /Properties &gt; Patches/);
  assert.match(compiled, /<code>patches<\/code>/);
  assert.match(compiled, /&lt;PCSX2 folder&gt;\\patches\\SLUS-21847_F233A433\.pnach/);
  assert.match(compiled, /href="\/pnach\/SLUS-21847_F233A433.training-controls.pnach" download="SLUS-21847_F233A433.pnach"/);
  assert.match(compiled, /<ol><li>VENOM 640 \/ HUNTER: Gold Venom, FIXED CPU 32\.<\/li>/);
  assert.match(compiled, /EXP Up, Hunter, Life Recovery, in that order/);
  assert.equal(native.match(/VENOM 640 \/ HUNTER/g)?.length, 1);
  assert.doesNotMatch(native, /Setup instructions/);
});

let REJECTION_CASES: readonly RejectionCase[] = [
  {
    name: "untested evidence",
    mutate: (feature: FeatureFixture): void => {
      feature.evidence.status = "NOT TESTED";
    },
    message: /VERIFIED runtime evidence/,
  },
  {
    name: "static-only evidence",
    mutate: (feature: FeatureFixture): void => {
      feature.evidence.level = "S1";
    },
    message: /VERIFIED runtime evidence/,
  },
  {
    name: "wrong release CRC",
    mutate: (feature: FeatureFixture): void => {
      feature.release.crc = "DEADBEEF";
    },
    message: /mismatched release/,
  },
  {
    name: "wrong release version",
    mutate: (feature: FeatureFixture): void => {
      feature.release.version = "1.01";
    },
    message: /mismatched release/,
  },
  {
    name: "wrong tested build",
    mutate: (feature: FeatureFixture): void => {
      feature.evidence.testedBuild = "SLUS-21847@1.01/F233A433";
    },
    message: /testedBuild mismatch/,
  },
  {
    name: "wrong evidence checksum",
    mutate: (feature: FeatureFixture): void => {
      feature.source.sha256 = "0".repeat(64);
    },
    message: /checksum mismatch/,
  },
  {
    name: "path traversal",
    mutate: (feature: FeatureFixture): void => {
      feature.source.path = "games/../secret.env";
    },
    message: /unsafe repository path/,
  },
  {
    name: "invalid raw patch",
    mutate: (feature: FeatureFixture): void => {
      feature.kind = "simple-code";
      feature.raw = ["patch=inject"];
    },
    message: /invalid raw code/,
  },
  {
    name: "empty controls",
    mutate: (feature: FeatureFixture): void => {
      feature.controls = [];
    },
    message: /at least one item/,
  },
  {
    name: "missing reset instructions",
    mutate: (feature: FeatureFixture): void => {
      delete feature.lifecycle.reset;
    },
    message: /lifecycle.reset/,
  },
  {
    name: "unpublished dependency",
    mutate: (feature: FeatureFixture): void => {
      feature.dependencies = ["unfinished"];
    },
    message: /unpublished.*reference/,
  },
  {
    name: "native patch leakage",
    mutate: (feature: FeatureFixture): void => {
      feature.raw = ["20123450 00000001"];
    },
    message: /native tips cannot contain/,
  },
  {
    name: "reserved page ID",
    mutate: (feature: FeatureFixture): void => {
      feature.id = "sheet";
    },
    message: /reserved release page ID/,
  },
];
for (let { name, mutate, message } of REJECTION_CASES) {
  test(`rejects ${name}`, (context: TestContext): void => {
    let catalog: CatalogFixture = fixture(context);
    mutate(catalog.feature);
    catalog.writeCatalog([catalog.feature, DRAFT]);
    assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), message);
  });
}

test("rejects edited evidence even after updating its digest without a new source commit", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  const edited: string = "Different runtime observation.\n";
  catalog.writeFile(EVIDENCE_PATH, edited);
  catalog.feature.source.sha256 = sha256(edited);
  catalog.writeCatalog([catalog.feature]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /differs from pinned source revision/);
});

test("rejects stale module bytes and an artifact with the wrong game identity", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  delete catalog.feature.instructions;
  catalog.feature.kind = "compiled-module";
  catalog.feature.artifact = artifactPin();
  catalog.writeFile(ARTIFACT_PATH, ARTIFACT_TEXT + "// Edited\n");
  catalog.writeCatalog([catalog.feature]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /artifact: current file checksum mismatch/);
  const wrongIdentity: string = ARTIFACT_TEXT.replace("F233A433", "DEADBEEF");
  catalog.writeFile(ARTIFACT_PATH, wrongIdentity);
  pinArtifactCommit(catalog, "Change fixture artifact");
  catalog.feature.artifact = artifactPin(wrongIdentity);
  catalog.writeCatalog([catalog.feature]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /artifact release identity mismatch/);
});

test("simple-code downloads must preserve every ordered raw write", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  const shortArtifact: string = ARTIFACT_TEXT.replace("\n[Controls]\npatch=0,EE,20123454,extended,00000002\n", "");
  catalog.writeFile(ARTIFACT_PATH, shortArtifact);
  pinArtifactCommit(catalog, "Pin short code");
  let raw: string[] = ["20123450 00000001"];
  catalog.feature.kind = "simple-code";
  catalog.feature.raw = raw;
  catalog.feature.artifact = artifactPin(shortArtifact);
  catalog.writeCatalog([catalog.feature]);
  let [entry]: readonly CatalogFeature[] = loadCatalog(catalog.repo, [catalog.release]);
  assert.equal(requireArtifactText(entry), shortArtifact);
  assert.equal(entry?.artifact?.sha256, sha256(shortArtifact));
  raw.push("20123454 00000002");
  catalog.writeCatalog([catalog.feature]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /differs from ordered raw lines/);
});

test("repeated extended-code conditions retain their exact order in simple-code downloads", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  const raw: readonly string[] = ["E0010001 10123450", "20123454 00000002", "E0010001 10123450", "20123458 00000003"];
  catalog.feature.kind = "simple-code";
  catalog.feature.raw = [...raw];
  catalog.writeCatalog([catalog.feature]);
  let [entry]: readonly CatalogFeature[] = loadCatalog(catalog.repo, [catalog.release]);
  assert.deepEqual(entry?.raw, raw);
  assert.deepEqual(
    requireArtifactText(entry)
      .split("\n")
      .filter((line: string): boolean => line.startsWith("patch=")),
    raw.map((line: string): string => `patch=1,EE,${line.slice(0, 8)},extended,${line.slice(9)}`),
  );
});

test("simple-code artifacts reject boot-only writes while compiled modules preserve them", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  const initialization: string = ARTIFACT_TEXT.replace("\n[Engine]\npatch=1,EE,20123450,extended,00000001\n", "");
  catalog.writeFile(ARTIFACT_PATH, initialization);
  pinArtifactCommit(catalog, "Pin initialization code");
  catalog.feature.kind = "simple-code";
  catalog.feature.raw = ["20123454 00000002"];
  catalog.feature.artifact = artifactPin(initialization);
  catalog.writeCatalog([catalog.feature]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /requires continuous patch=1 writes/);
  catalog.feature.kind = "compiled-module";
  delete catalog.feature.raw;
  catalog.writeCatalog([catalog.feature]);
  let [entry]: readonly CatalogFeature[] = loadCatalog(catalog.repo, [catalog.release]);
  assert.equal(requireArtifactText(entry), initialization);
  assert.equal(entry?.artifact?.sha256, sha256(initialization));
});

for (const isTransitive of [false, true]) {
  test(`rejects conflicts among ${isTransitive ? "transitive" : "direct"} required dependencies`, (context: TestContext): void => {
    let catalog: CatalogFixture = fixture(context);
    let left: FeatureFixture = { ...catalog.feature, id: "left", conflicts: ["right"] };
    let right: FeatureFixture = { ...catalog.feature, id: "right" };
    let middle: FeatureFixture = { ...catalog.feature, id: "middle", dependencies: [left.id, right.id] };
    catalog.feature.dependencies = isTransitive ? [middle.id] : [left.id, right.id];
    catalog.writeCatalog([catalog.feature, left, right, ...(isTransitive ? [middle] : [])]);
    assert.throws(
      (): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]),
      /required feature set contains conflicting entries left and right/,
    );
  });
}

test("rejects duplicate IDs and circular dependencies", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  catalog.writeCatalog([catalog.feature, catalog.feature]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /duplicate feature ID/);
  let second: FeatureFixture = { ...catalog.feature, id: "second", dependencies: [catalog.feature.id] };
  catalog.feature.dependencies = [second.id];
  catalog.writeCatalog([catalog.feature, second]);
  assert.throws((): readonly CatalogFeature[] => loadCatalog(catalog.repo, [catalog.release]), /circular dependency/);
});

test("does not discover modules or draft patches without an explicit catalog", (context: TestContext): void => {
  let catalog: CatalogFixture = fixture(context);
  assert.deepEqual(loadCatalog(catalog.repo, [catalog.release]), []);
});

test(
  "existing catalog still builds with every code page and original release file",
  { skip: !process.env["RETRO_REPO"] },
  (context: TestContext): void => {
    const output: string = execFileSync(process.execPath, ["build.ts"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.match(output, /13 releases/);
    const searchIndex: readonly SearchEntry[] = parseSearch(
      JSON.parse(fs.readFileSync(new URL("../dist/search.json", import.meta.url), "utf8")),
    );
    assert.ok(searchIndex.length >= 494, "all existing 494 feature pages remain searchable");
    assert.ok(searchIndex.some((entry: SearchEntry): boolean => entry.t === "Unlock everything"));
    const pnachIndex: readonly PnachIndexEntry[] = parsePnachIndex(
      JSON.parse(fs.readFileSync(new URL("../pnach/index.json", import.meta.url), "utf8")),
    );
    assert.equal(pnachIndex.filter((entry: PnachIndexEntry): boolean => entry.featureId === null).length, 9);
    assert.ok(pnachIndex.every((entry: PnachIndexEntry): boolean => entry.patchSections > 0));
    const home: string = fs.readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
    assert.match(home, /feature pages/);
    assert.match(home, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="logo"/);
    const howTo: string = fs.readFileSync(new URL("../dist/how-to/index.html", import.meta.url), "utf8");
    const downloads: string = fs.readFileSync(new URL("../dist/downloads/index.html", import.meta.url), "utf8");
    assert.match(howTo, /Properties &gt; Patches/);
    for (const id of ["cpu-modes-us", "cpu-survival-us"]) {
      const page: string = fs.readFileSync(
        new URL(`../dist/games/guilty-gear-xx-accent-core-plus/us-slus-21847/${id}/index.html`, import.meta.url),
        "utf8",
      );
      assert.match(page, /Properties (?:\/|&gt;) Patches,? enable/);
      assert.doesNotMatch(page, /Properties \/ Cheats|configured cheats folder|Settings \/ Folders \/ Cheats|Reload cheats/);
    }
    assert.match(howTo, /Legacy release cheat files/);
    assert.match(howTo, /Properties &gt; Cheats/);
    assert.match(downloads, /Selectable feature downloads go in <code>patches<\/code>/);
    assert.match(downloads, /Legacy release cheat files use <code>cheats<\/code>/);
    assert.match(home, /downloadable patch sections/);
    let site: Site = loadSite();
    site.priorMap = new Map();
    let acPlus: Release | undefined = site.releases.find((release: Release): boolean => release.serial === "SLUS-21847");
    if (acPlus === undefined) return assert.fail("expected the AC+ US release");
    assert.equal(acPlus.codes.filter((code: Code): boolean => !code.kind).length, 134);
    assert.equal(acPlus.codes.filter((code: Code): boolean => code.published !== undefined).length, 16);
    assert.equal(pnachIndex.filter((entry: PnachIndexEntry): boolean => entry.featureId !== null).length, 20);
    const acceptedArtifacts: ReadonlyArray<readonly [string, string]> = [
      ["cpu-modes-us", "05de263945b40fd34f8a7a912590417f8bafdea9c74b1fb8c615de683708ba9c"],
      ["survival-continue-us", "5bc1f23091e649c9d7419bb9fc041fd55a63832ad05b829167d061edc3d96cb2"],
      ["survival-player-forms-us", "473255a60361b7cb5b0dae0670986f4da4f5f982013f311460e392940f01a0fb"],
    ];
    for (const [id, hash] of acceptedArtifacts) {
      let feature: Code | undefined = acPlus.codes.find((code: Code): boolean => code.id === id);
      assert.equal(feature?.artifact?.sha256, hash, `${id} uses its accepted artifact`);
    }
    const releaseFile: PnachIndexEntry | undefined = pnachIndex.find((entry: PnachIndexEntry): boolean => entry.file === "F233A433.pnach");
    assert.equal(releaseFile?.patchSections, 118);
    assert.equal(releaseFile?.featurePages, 134);

    let catalog: CatalogFixture = fixture(context);
    catalog.feature.kind = "compiled-module";
    catalog.feature.artifact = artifactPin();
    catalog.feature.compatibilityNotes = ["Do not combine with an external camera engine."];
    catalog.writeCatalog([catalog.feature]);
    let [feature]: readonly CatalogFeature[] = loadCatalog(catalog.repo, [acPlus]);
    if (feature === undefined || feature.artifact === null) return assert.fail("expected one compiled module");
    acPlus.codes.push(feature);
    const page: string = codePage(feature, site, {});
    assert.match(page, /Compiled module/);
    assert.match(page, /2 patch sections/);
    assert.match(page, /Do not combine with an external camera engine/);
    assert.match(page, new RegExp(feature.artifact.sha256));
    assert.doesNotMatch(page, /id="raw"/);
    assert.match(releasePage(acPlus, site), new RegExp(feature.id));
    const sheet: string | undefined = sheetPage(acPlus, site).match(/<pre class="code sheet"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    assert.doesNotMatch(sheet ?? assert.fail("expected a raw sheet"), /20123450/);
  },
);
