// Only explicit, evidence-pinned catalog entries may add public feature pages.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parsePnach } from "./lib.mjs";

export const CATALOG_PATH = "games/guiltycodes/catalog";
export const FEATURE_CATEGORIES = ["Native shortcuts", "Training", "CPU and controls", "Match rules", "Presentation", "Unlocks", "Utilities"];
export const FEATURE_KINDS = ["native-tip", "simple-code", "compiled-module"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`Catalog: ${message}`); };
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be nonempty text`);
  return value;
};
const list = (value, label, { nonempty = false, unique = true } = {}) => {
  if (!Array.isArray(value) || (nonempty && !value.length)) fail(`${label} must be an array${nonempty ? " with at least one item" : ""}`);
  value.forEach((item) => text(item, label));
  if (unique && new Set(value).size !== value.length) fail(`${label} contains duplicates`);
  return value;
};
const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 8 * 1024 * 1024 });

function checkedFile(repo, pin, revision, label) {
  const relative = text(pin?.path, `${label}.path`);
  if (!relative.startsWith("games/") || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) fail(`${label}: unsafe repository path`);
  if (!/^[a-f0-9]{64}$/.test(pin.sha256)) fail(`${label}: invalid SHA-256`);
  const root = fs.realpathSync(repo);
  const file = fs.realpathSync(path.join(root, relative));
  if (!file.startsWith(root + path.sep)) fail(`${label}: file escapes repository`);
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== pin.sha256) fail(`${label}: current file checksum mismatch`);
  if (digest(git(repo, ["show", `${revision}:${relative}`])) !== pin.sha256) fail(`${label}: file differs from pinned source revision`);
  return bytes;
}

function checkedPnach(bytes, release, label) {
  const value = bytes.toString("utf8").replace(/\r\n/g, "\n");
  const parsed = parsePnach(value);
  if (!new RegExp(`\\b${release.serial}\\b`).test(parsed.header.gametitle) || !new RegExp(`\\b${release.crc}\\b`).test(parsed.header.gametitle)) fail(`${label}: artifact release identity mismatch`);
  for (const line of value.split("\n")) {
    if (!line.trim() || /^(?:gametitle|comment|author|description)=/.test(line) || /^\[[^\]\r\n]+\]$/.test(line) || /^\/\//.test(line)) continue;
    if (!/^patch=[01],EE,[A-F0-9]{8},extended,[A-F0-9]{8}$/.test(line)) fail(`${label}: unsupported artifact line: ${line}`);
  }
  if (!parsed.sections.length || parsed.sections.some((section) => !section.raw.length)) fail(`${label}: artifact has empty patch sections`);
  const patchCount = value.split("\n").filter((line) => line.startsWith("patch=")).length;
  if (parsed.sections.reduce((n, section) => n + section.raw.length, 0) !== patchCount) fail(`${label}: patch outside a named section`);
  return { text: value, sectionCount: parsed.sections.length, sections: parsed.sections };
}

export function loadCatalog(repo, releases) {
  const directory = path.join(repo, CATALOG_PATH);
  if (!fs.existsSync(directory)) return [];
  const features = [];
  const ids = new Set();
  for (const name of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    const document = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    if (document.schemaVersion !== 1 || !Array.isArray(document.features)) fail(`${name}: expected schemaVersion 1 and features array`);
    for (const entry of document.features) {
      const id = text(entry.id, `${name}.id`);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${id}: invalid stable feature ID`);
      if (["sheet", "unlockables", "faq", "tests", "prior-art"].includes(id)) fail(`${id}: reserved release page ID`);
      if (ids.has(id)) fail(`${id}: duplicate feature ID`);
      ids.add(id);
      if (!["draft", "published"].includes(entry.publication)) fail(`${id}: publication must be draft or published`);
      if (entry.publication === "draft") continue;
      if (!FEATURE_KINDS.includes(entry.kind)) fail(`${id}: unsupported feature kind`);
      if (!FEATURE_CATEGORIES.includes(entry.category)) fail(`${id}: unsupported feature category`);
      text(entry.title, `${id}.title`);
      const release = releases.find((release) => release.serial === entry.release?.serial && release.crc === entry.release?.crc && release.version === entry.release?.version);
      if (!release) fail(`${id}: unknown or mismatched release serial, version or CRC`);
      const evidence = entry.evidence;
      if (evidence?.status !== "VERIFIED" || !/^S[2-6]$/.test(evidence.level)) fail(`${id}: published feature requires VERIFIED runtime evidence (S2-S6)`);
      if (evidence.testedBuild !== `${release.serial}@${release.version}/${release.crc}`) fail(`${id}: evidence testedBuild mismatch`);
      text(evidence.result, `${id}.evidence.result`);
      const revision = entry.source?.revision;
      if (!/^[a-f0-9]{40}$/.test(revision)) fail(`${id}: source revision must be a full commit hash`);
      git(repo, ["merge-base", "--is-ancestor", revision, "HEAD"]);
      checkedFile(repo, entry.source, revision, `${id}.source`);
      list(entry.controls, `${id}.controls`, { nonempty: true });
      list(entry.dependencies, `${id}.dependencies`);
      list(entry.conflicts, `${id}.conflicts`);
      if (entry.compatibilityNotes !== undefined) list(entry.compatibilityNotes, `${id}.compatibilityNotes`);
      for (const key of ["enable", "disable", "reset", "persistence"]) text(entry.lifecycle?.[key], `${id}.lifecycle.${key}`);
      let pnach = null;
      let artifact = null;
      let raw = [];
      if (entry.kind === "native-tip") {
        list(entry.instructions, `${id}.instructions`, { nonempty: true });
        if (entry.artifact || entry.raw) fail(`${id}: native tips cannot contain memory patches`);
      } else if (entry.kind === "simple-code") {
        // Extended-code condition blocks can repeat; their order is executable meaning.
        raw = list(entry.raw, `${id}.raw`, { nonempty: true, unique: false });
        if (raw.some((line) => !/^[A-F0-9]{8} [A-F0-9]{8}$/.test(line))) fail(`${id}: invalid raw code`);
        if (/[\r\n\[\]]/.test(entry.title)) fail(`${id}: title cannot be a patch directive`);
        pnach = `gametitle=${release.serial} (${release.crc})\n\n[${entry.title}]\n${raw.map((line) => `patch=1,EE,${line.slice(0, 8)},extended,${line.slice(9)}`).join("\n")}\n`;
        artifact = { file: `${release.serial}_${release.crc}.${id}.pnach`, text: pnach, sha256: digest(pnach), sectionCount: 1 };
      } else {
        if (!entry.artifact?.path?.startsWith("games/guiltycodes/artifacts/") || !entry.artifact.path.endsWith(".pnach")) fail(`${id}: module artifact must be a catalog .pnach`);
        if (entry.raw) fail(`${id}: compiled modules cannot be flattened into raw codes`);
        const bytes = checkedFile(repo, entry.artifact, revision, `${id}.artifact`);
        const parsed = checkedPnach(bytes, release, id);
        pnach = parsed.text;
        artifact = { file: `${release.serial}_${release.crc}.${id}.pnach`, text: bytes, sha256: entry.artifact.sha256, sectionCount: parsed.sectionCount };
      }
      if (entry.kind === "simple-code" && entry.artifact) {
        if (!entry.artifact.path?.startsWith("games/guiltycodes/artifacts/") || !entry.artifact.path.endsWith(".pnach")) fail(`${id}: simple-code artifact must be a catalog .pnach`);
        const bytes = checkedFile(repo, entry.artifact, revision, `${id}.artifact`);
        const parsed = checkedPnach(bytes, release, id);
        if (parsed.sectionCount !== 1 || parsed.sections[0].raw.join("\n") !== raw.join("\n")) fail(`${id}: simple-code artifact differs from ordered raw lines`);
        if (parsed.sections[0].patches.some((patch) => !patch.startsWith("patch=1,"))) fail(`${id}: simple-code artifact requires continuous patch=1 writes; use a compiled module for initialization patches`);
        pnach = parsed.text;
        artifact = { file: `${release.serial}_${release.crc}.${id}.pnach`, text: bytes, sha256: entry.artifact.sha256, sectionCount: 1 };
      }
      features.push({
        id, title: entry.title, kind: entry.kind, group: entry.category,
        effect: entry.description ? text(entry.description, `${id}.description`) : evidence.result,
        raw, pnach, artifact, status: evidence.status, level: evidence.level,
        checked: evidence.result, hardware: "NOT TESTED", controls: entry.controls,
        dependencies: entry.dependencies, conflicts: entry.conflicts, compatibilityNotes: entry.compatibilityNotes ?? [], lifecycle: entry.lifecycle,
        instructions: entry.instructions ?? [], source: entry.source, release,
      });
    }
  }
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  for (const feature of features) {
    if (feature.release.codes.some((code) => code.id === feature.id)) fail(`${feature.id}: collides with an existing code page`);
    for (const reference of [...feature.dependencies, ...feature.conflicts]) {
      const target = byId.get(reference);
      if (!target || target === feature || target.release !== feature.release) fail(`${feature.id}: invalid, unpublished or cross-release reference ${reference}`);
    }
    if (feature.dependencies.some((id) => feature.conflicts.includes(id))) fail(`${feature.id}: dependency also declared as a conflict`);
  }
  const visit = (feature, selected, chain = new Set()) => {
    if (chain.has(feature.id)) fail(`${feature.id}: circular dependency`);
    if (selected.has(feature.id)) return;
    selected.add(feature.id);
    for (const id of feature.dependencies) visit(byId.get(id), selected, new Set([...chain, feature.id]));
  };
  for (const feature of features) {
    const selected = new Set();
    visit(feature, selected);
    for (const id of selected) {
      const conflict = byId.get(id).conflicts.find((target) => selected.has(target));
      if (conflict) fail(`${feature.id}: required feature set contains conflicting entries ${id} and ${conflict}`);
    }
  }
  return features;
}
