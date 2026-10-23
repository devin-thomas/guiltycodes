import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadCatalog, CATALOG_PATH } from "../build/catalog.ts";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const evidencePath = "games/example/EVIDENCE.md";
const artifactPath = "games/guiltycodes/artifacts/module.pnach";
const artifactText =
  "gametitle=Example [SLUS-21847] (F233A433)\n\n[Engine]\npatch=1,EE,20123450,extended,00000001\n\n[Controls]\npatch=0,EE,20123454,extended,00000002\n";

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guiltycodes-catalog-"));
  t.after(() => fs.rmSync(repo, { force: true, recursive: true }));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-b", "main");
  const put = (file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), bytes);
  };
  put(evidencePath, "# Runtime evidence\nObserved on a disposable save.\n");
  put(artifactPath, artifactText);
  git("add", "games");
  git(
    "-c",
    "user.name=Catalog test",
    "-c",
    "user.email=catalog@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Pin fixture evidence",
  );
  const revision = git("rev-parse", "HEAD").trim();
  const release = { serial: "SLUS-21847", crc: "F233A433", version: "1.00", codes: [] };
  const feature = {
    id: "training-controls",
    title: "Training controls",
    kind: "native-tip",
    category: "Training",
    publication: "published",
    release: { serial: release.serial, crc: release.crc, version: release.version },
    source: { revision, path: evidencePath, sha256: sha(fs.readFileSync(path.join(repo, evidencePath))) },
    evidence: { status: "VERIFIED", level: "S2", result: "Observed training controls.", testedBuild: "SLUS-21847@1.00/F233A433" },
    controls: ["Pause, then select Training"],
    dependencies: [],
    conflicts: [],
    lifecycle: { enable: "Open training", disable: "Leave training", reset: "Restart", persistence: "None" },
    instructions: ["Open the training menu."],
  };
  const write = (features) => put(`${CATALOG_PATH}/example.json`, JSON.stringify({ schemaVersion: 1, features }));
  return { repo, release, feature, write, put, git };
}

test("accepts native tips, raw codes and intact multi-section modules without flattening", (t) => {
  const f = fixture(t);
  const simple = { ...f.feature, id: "hud-off", kind: "simple-code", raw: ["20123450 00000001"] };
  const module = {
    ...f.feature,
    id: "camera",
    kind: "compiled-module",
    category: "Presentation",
    dependencies: ["hud-off"],
    artifact: { path: artifactPath, sha256: sha(artifactText) },
  };
  f.write([f.feature, simple, module, { id: "unfinished", publication: "draft" }]);
  const entries = loadCatalog(f.repo, [f.release]);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].artifact, null);
  assert.equal(entries[1].artifact.sectionCount, 1);
  assert.equal(entries[2].artifact.sectionCount, 2);
  assert.equal(entries[2].artifact.text.toString(), artifactText);
  assert.deepEqual(entries[2].raw, []);
  assert.equal(entries[2].artifact.sha256, sha(entries[2].artifact.text));
});

for (const kind of ["simple-code", "compiled-module"]) {
  for (const instructions of ["not an array", [], [""]]) {
    test(`${kind} rejects invalid optional instructions ${JSON.stringify(instructions)}`, (t) => {
      const f = fixture(t);
      f.feature.kind = kind;
      f.feature.instructions = instructions;
      if (kind === "simple-code") f.feature.raw = ["20123450 00000001"];
      else f.feature.artifact = { path: artifactPath, sha256: sha(artifactText) };
      f.write([f.feature]);
      assert.throws(() => loadCatalog(f.repo, [f.release]), /instructions/);
    });
  }
}

test("compiled setup instructions render publicly and native instructions appear only once", (t) => {
  const f = fixture(t);
  f.feature.kind = "compiled-module";
  f.feature.artifact = { path: artifactPath, sha256: sha(artifactText) };
  f.feature.instructions = [
    "VENOM 640 / HUNTER: Gold Venom, FIXED CPU 32.",
    "SOL 960 / LIFE REC: EXP Up, Hunter, Life Recovery, in that order.",
  ];
  f.write([f.feature]);
  const release = { ...f.release, label: "US", game: { id: "fixture", title: "Fixture", slug: "fixture" }, url: "/games/fixture/us/" };
  const script = `
    import { loadCatalog } from "./build/catalog.ts";
    import { codePage } from "./build/render.ts";
    const release = JSON.parse(process.env.RENDER_RELEASE);
    const [feature] = loadCatalog(process.env.RETRO_REPO, [release]);
    feature.url = release.url + feature.id + "/";
    release.codes.push(feature);
    const site = { games: [], priorMap: new Map(), built: "2026-10-22" };
    const compiled = codePage(feature, site, {});
    feature.kind = "native-tip";
    const native = codePage(feature, site, {});
    console.log(JSON.stringify({ compiled, native }));
  `;
  const pages = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, RETRO_REPO: f.repo, RENDER_RELEASE: JSON.stringify(release) },
    }),
  );
  assert.match(pages.compiled, /Setup instructions/);
  assert.match(pages.compiled, /Tools &gt; Open Data Directory/);
  assert.match(pages.compiled, /Properties &gt; Patches/);
  assert.match(pages.compiled, /<code>patches<\/code>/);
  assert.match(pages.compiled, /&lt;PCSX2 folder&gt;\\patches\\SLUS-21847_F233A433\.pnach/);
  assert.match(pages.compiled, /href="\/pnach\/SLUS-21847_F233A433.training-controls.pnach" download="SLUS-21847_F233A433.pnach"/);
  assert.match(pages.compiled, /<ol><li>VENOM 640 \/ HUNTER: Gold Venom, FIXED CPU 32\.<\/li>/);
  assert.match(pages.compiled, /EXP Up, Hunter, Life Recovery, in that order/);
  assert.equal(pages.native.match(/VENOM 640 \/ HUNTER/g).length, 1);
  assert.doesNotMatch(pages.native, /Setup instructions/);
});

for (const [name, mutate, message] of [
  [
    "untested evidence",
    (f) => {
      f.evidence.status = "NOT TESTED";
    },
    /VERIFIED runtime evidence/,
  ],
  [
    "static-only evidence",
    (f) => {
      f.evidence.level = "S1";
    },
    /VERIFIED runtime evidence/,
  ],
  [
    "wrong release CRC",
    (f) => {
      f.release.crc = "DEADBEEF";
    },
    /mismatched release/,
  ],
  [
    "wrong release version",
    (f) => {
      f.release.version = "1.01";
    },
    /mismatched release/,
  ],
  [
    "wrong tested build",
    (f) => {
      f.evidence.testedBuild = "SLUS-21847@1.01/F233A433";
    },
    /testedBuild mismatch/,
  ],
  [
    "wrong evidence checksum",
    (f) => {
      f.source.sha256 = "0".repeat(64);
    },
    /checksum mismatch/,
  ],
  [
    "path traversal",
    (f) => {
      f.source.path = "games/../secret.env";
    },
    /unsafe repository path/,
  ],
  [
    "invalid raw patch",
    (f) => {
      f.kind = "simple-code";
      f.raw = ["patch=inject"];
    },
    /invalid raw code/,
  ],
  [
    "empty controls",
    (f) => {
      f.controls = [];
    },
    /at least one item/,
  ],
  [
    "missing reset instructions",
    (f) => {
      delete f.lifecycle.reset;
    },
    /lifecycle.reset/,
  ],
  [
    "unpublished dependency",
    (f) => {
      f.dependencies = ["unfinished"];
    },
    /unpublished.*reference/,
  ],
  [
    "native patch leakage",
    (f) => {
      f.raw = ["20123450 00000001"];
    },
    /native tips cannot contain/,
  ],
  [
    "reserved page ID",
    (f) => {
      f.id = "sheet";
    },
    /reserved release page ID/,
  ],
]) {
  test(`rejects ${name}`, (t) => {
    const f = fixture(t);
    mutate(f.feature);
    f.write([f.feature, { id: "unfinished", publication: "draft" }]);
    assert.throws(() => loadCatalog(f.repo, [f.release]), message);
  });
}

test("rejects edited evidence even after updating its digest without a new source commit", (t) => {
  const f = fixture(t);
  const edited = "Different runtime observation.\n";
  f.put(evidencePath, edited);
  f.feature.source.sha256 = sha(edited);
  f.write([f.feature]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /differs from pinned source revision/);
});

test("rejects stale module bytes and an artifact with the wrong game identity", (t) => {
  const f = fixture(t);
  delete f.feature.instructions;
  f.feature.kind = "compiled-module";
  f.feature.artifact = { path: artifactPath, sha256: sha(artifactText) };
  f.put(artifactPath, artifactText + "// Edited\n");
  f.write([f.feature]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /artifact: current file checksum mismatch/);
  const wrong = artifactText.replace("F233A433", "DEADBEEF");
  f.put(artifactPath, wrong);
  f.git("add", "games/guiltycodes/artifacts");
  f.git(
    "-c",
    "user.name=Catalog test",
    "-c",
    "user.email=catalog@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Change fixture artifact",
  );
  f.feature.source.revision = f.git("rev-parse", "HEAD").trim();
  f.feature.artifact.sha256 = sha(wrong);
  f.write([f.feature]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /artifact release identity mismatch/);
});

test("simple-code downloads must preserve every ordered raw write", (t) => {
  const f = fixture(t);
  const shortArtifact = artifactText.replace("\n[Controls]\npatch=0,EE,20123454,extended,00000002\n", "");
  f.put(artifactPath, shortArtifact);
  f.git("add", "games/guiltycodes/artifacts");
  f.git(
    "-c",
    "user.name=Catalog test",
    "-c",
    "user.email=catalog@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Pin short code",
  );
  f.feature.source.revision = f.git("rev-parse", "HEAD").trim();
  f.feature.kind = "simple-code";
  f.feature.raw = ["20123450 00000001"];
  f.feature.artifact = { path: artifactPath, sha256: sha(shortArtifact) };
  f.write([f.feature]);
  const [entry] = loadCatalog(f.repo, [f.release]);
  assert.equal(entry.artifact.text.toString(), shortArtifact);
  assert.equal(entry.artifact.sha256, sha(shortArtifact));
  f.feature.raw.push("20123454 00000002");
  f.write([f.feature]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /differs from ordered raw lines/);
});

test("repeated extended-code conditions retain their exact order in simple-code downloads", (t) => {
  const f = fixture(t);
  const raw = ["E0010001 10123450", "20123454 00000002", "E0010001 10123450", "20123458 00000003"];
  f.feature.kind = "simple-code";
  f.feature.raw = raw;
  f.write([f.feature]);
  const [entry] = loadCatalog(f.repo, [f.release]);
  assert.deepEqual(entry.raw, raw);
  assert.deepEqual(
    entry.artifact.text.split("\n").filter((line) => line.startsWith("patch=")),
    raw.map((line) => `patch=1,EE,${line.slice(0, 8)},extended,${line.slice(9)}`),
  );
});

test("simple-code artifacts reject boot-only writes while compiled modules preserve them", (t) => {
  const f = fixture(t);
  const initial = artifactText.replace("\n[Engine]\npatch=1,EE,20123450,extended,00000001\n", "");
  f.put(artifactPath, initial);
  f.git("add", "games/guiltycodes/artifacts");
  f.git(
    "-c",
    "user.name=Catalog test",
    "-c",
    "user.email=catalog@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Pin initialization code",
  );
  f.feature.source.revision = f.git("rev-parse", "HEAD").trim();
  f.feature.kind = "simple-code";
  f.feature.raw = ["20123454 00000002"];
  f.feature.artifact = { path: artifactPath, sha256: sha(initial) };
  f.write([f.feature]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /requires continuous patch=1 writes/);
  f.feature.kind = "compiled-module";
  delete f.feature.raw;
  f.write([f.feature]);
  const [entry] = loadCatalog(f.repo, [f.release]);
  assert.equal(entry.artifact.text.toString(), initial);
  assert.equal(entry.artifact.sha256, sha(initial));
});

for (const transitive of [false, true]) {
  test(`rejects conflicts among ${transitive ? "transitive" : "direct"} required dependencies`, (t) => {
    const f = fixture(t);
    const left = { ...f.feature, id: "left", conflicts: ["right"] };
    const right = { ...f.feature, id: "right" };
    const middle = { ...f.feature, id: "middle", dependencies: [left.id, right.id] };
    f.feature.dependencies = transitive ? [middle.id] : [left.id, right.id];
    f.write([f.feature, left, right, ...(transitive ? [middle] : [])]);
    assert.throws(() => loadCatalog(f.repo, [f.release]), /required feature set contains conflicting entries left and right/);
  });
}

test("rejects duplicate IDs and circular dependencies", (t) => {
  const f = fixture(t);
  f.write([f.feature, f.feature]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /duplicate feature ID/);
  const second = { ...f.feature, id: "second", dependencies: [f.feature.id] };
  f.feature.dependencies = [second.id];
  f.write([f.feature, second]);
  assert.throws(() => loadCatalog(f.repo, [f.release]), /circular dependency/);
});

test("does not discover modules or draft patches without an explicit catalog", (t) => {
  const f = fixture(t);
  assert.deepEqual(loadCatalog(f.repo, [f.release]), []);
});

test("existing catalog still builds with every code page and original release file", { skip: !process.env.RETRO_REPO }, async (t) => {
  const output = execFileSync(process.execPath, ["build.ts"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.match(output, /13 releases/);
  const search = JSON.parse(fs.readFileSync(new URL("../dist/search.json", import.meta.url), "utf8"));
  assert.ok(search.length >= 494, "all existing 494 feature pages remain searchable");
  assert.ok(search.some((entry) => entry.t === "Unlock everything"));
  const index = JSON.parse(fs.readFileSync(new URL("../pnach/index.json", import.meta.url), "utf8"));
  assert.equal(index.filter((entry) => entry.featureId === null).length, 9);
  assert.ok(index.every((entry) => entry.patchSections > 0));
  const home = fs.readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(home, /feature pages/);
  assert.match(home, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="logo"/);
  const howTo = fs.readFileSync(new URL("../dist/how-to/index.html", import.meta.url), "utf8");
  const downloads = fs.readFileSync(new URL("../dist/downloads/index.html", import.meta.url), "utf8");
  assert.match(howTo, /Properties &gt; Patches/);
  assert.match(howTo, /Legacy release cheat files/);
  assert.match(howTo, /Properties &gt; Cheats/);
  assert.match(downloads, /Selectable feature downloads go in <code>patches<\/code>/);
  assert.match(downloads, /Legacy release cheat files use <code>cheats<\/code>/);
  assert.match(home, /downloadable patch sections/);
  const { loadSite } = await import("../build/data.ts");
  const { codePage, releasePage, sheetPage } = await import("../build/render.ts");
  const site = loadSite();
  site.priorMap = new Map();
  const ac = site.releases.find((release) => release.serial === "SLUS-21847");
  assert.equal(ac.codes.filter((code) => !code.kind).length, 134);
  assert.equal(ac.codes.filter((code) => code.published).length, 16);
  assert.equal(index.find((entry) => entry.file === "F233A433.pnach").patchSections, 118);
  assert.equal(index.find((entry) => entry.file === "F233A433.pnach").featurePages, 134);

  const f = fixture(t);
  f.feature.kind = "compiled-module";
  f.feature.artifact = { path: artifactPath, sha256: sha(artifactText) };
  f.feature.compatibilityNotes = ["Do not combine with an external camera engine."];
  f.write([f.feature]);
  const [feature] = loadCatalog(f.repo, [ac]);
  feature.url = `${ac.url}${feature.id}/`;
  ac.codes.push(feature);
  const page = codePage(feature, site, {});
  assert.match(page, /Compiled module/);
  assert.match(page, /2 patch sections/);
  assert.match(page, /Do not combine with an external camera engine/);
  assert.match(page, new RegExp(feature.artifact.sha256));
  assert.doesNotMatch(page, /id="raw"/);
  assert.match(releasePage(ac, site), new RegExp(feature.id));
  const sheet = sheetPage(ac, site).match(/<pre class="code sheet"[^>]*>([\s\S]*?)<\/pre>/)[1];
  assert.doesNotMatch(sheet, /20123450/);
});
