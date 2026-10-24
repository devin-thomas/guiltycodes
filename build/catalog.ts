// Only explicit, evidence-pinned catalog entries may add public feature pages.
import type { PnachSection, Code } from "./model.ts";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parsePnach } from "./lib.ts";
import { parseArray, parseRecord, parseText, parseTextList } from "./validate.ts";
import { assertNever, requireValue } from "./model.ts";
import type {
  Artifact,
  CatalogFeature,
  CatalogFields,
  EvidenceLevel,
  FeatureCategory,
  FeatureKind,
  Lifecycle,
  ParsedPnach,
  Pin,
  Release,
} from "./model.ts";

export const CATALOG_PATH: "games/guiltycodes/catalog" = "games/guiltycodes/catalog";
export const FEATURE_CATEGORIES: readonly FeatureCategory[] = [
  "Native shortcuts",
  "Survival",
  "Training",
  "CPU and controls",
  "Match rules",
  "Presentation",
  "Unlocks",
  "Utilities",
];
const FEATURE_KINDS: readonly FeatureKind[] = ["native-tip", "simple-code", "compiled-module"];
function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function fail(message: string): never {
  throw new Error(`Catalog: ${message}`);
}
function git(repo: string, args: readonly string[]): Buffer {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 8 * 1024 * 1024 });
}
function parseFeatureKind(value: unknown, id: string): FeatureKind {
  for (const candidate of FEATURE_KINDS) if (candidate === value) return candidate;
  return fail(`${id}: unsupported feature kind`);
}
function parseCategory(value: unknown, id: string): FeatureCategory {
  for (const candidate of FEATURE_CATEGORIES) if (candidate === value) return candidate;
  return fail(`${id}: unsupported feature category`);
}
function parseRuntimeEvidenceLevel(value: unknown, id: string): EvidenceLevel {
  if (value === "S2" || value === "S3" || value === "S4" || value === "S5" || value === "S6") return value;
  return fail(`${id}: published feature requires VERIFIED runtime evidence (S2-S6)`);
}
function parsePin(value: unknown, revision: string, label: string): Pin {
  let pinData: Record<string, unknown> = parseRecord(value, label);
  return { path: parseText(pinData["path"], `${label}.path`), sha256: parseText(pinData["sha256"], `${label}.sha256`), revision };
}
function checkedFile(repo: string, pin: Pin, revision: string, label: string): Buffer {
  const relative: string = pin.path;
  if (
    !relative.startsWith("games/") ||
    relative.includes("\\") ||
    relative.split("/").some((part: string): boolean => !part || part === "." || part === "..")
  )
    fail(`${label}: unsafe repository path`);
  if (!/^[a-f0-9]{64}$/.test(pin.sha256)) fail(`${label}: invalid SHA-256`);
  const root: string = fs.realpathSync(repo);
  const file: string = fs.realpathSync(path.join(root, relative));
  if (!file.startsWith(root + path.sep)) fail(`${label}: file escapes repository`);
  let bytes: Buffer = fs.readFileSync(file);
  if (digest(bytes) !== pin.sha256) fail(`${label}: current file checksum mismatch`);
  if (digest(git(repo, ["show", `${revision}:${relative}`])) !== pin.sha256) fail(`${label}: file differs from pinned source revision`);
  return bytes;
}
type CheckedPnach = { readonly text: string; readonly sectionCount: number; readonly sections: ParsedPnach["sections"] };
type ModuleArtifact = { readonly artifact: Artifact; readonly pnach: string; readonly parsed: CheckedPnach };

function checkedPnach(bytes: Buffer, release: Release, label: string): CheckedPnach {
  const value: string = bytes.toString("utf8").replace(/\r\n/g, "\n");
  const parsed: ParsedPnach = parsePnach(value);
  if (
    !new RegExp(`\\b${release.serial}\\b`).test(parsed.header.gametitle) ||
    !new RegExp(`\\b${release.crc}\\b`).test(parsed.header.gametitle)
  )
    fail(`${label}: artifact release identity mismatch`);
  for (const line of value.split("\n")) {
    if (!line.trim() || /^(?:gametitle|comment|author|description)=/.test(line) || /^\[[^\]\r\n]+\]$/.test(line) || /^\/\//.test(line))
      continue;
    if (!/^patch=[01],EE,[A-F0-9]{8},extended,[A-F0-9]{8}$/.test(line)) fail(`${label}: unsupported artifact line: ${line}`);
  }
  if (!parsed.sections.length || parsed.sections.some((section: PnachSection): boolean => !section.raw.length))
    fail(`${label}: artifact has empty patch sections`);
  const patchCount: number = value.split("\n").filter((line: string): boolean => line.startsWith("patch=")).length;
  if (parsed.sections.reduce((count: number, section: PnachSection): number => count + section.raw.length, 0) !== patchCount)
    fail(`${label}: patch outside a named section`);
  return { text: value, sectionCount: parsed.sections.length, sections: parsed.sections };
}
function moduleArtifact(repo: string, value: unknown, revision: string, release: Release, id: string): ModuleArtifact {
  const artifactPin: Pin = parsePin(value, revision, `${id}.artifact`);
  if (!artifactPin.path.startsWith("games/guiltycodes/artifacts/") || !artifactPin.path.endsWith(".pnach"))
    fail(`${id}: module artifact must be a catalog .pnach`);
  let bytes: Buffer = checkedFile(repo, artifactPin, revision, `${id}.artifact`);
  const parsed: CheckedPnach = checkedPnach(bytes, release, id);
  return {
    artifact: {
      file: `${release.serial}_${release.crc}.${id}.pnach`,
      text: bytes,
      sha256: artifactPin.sha256,
      sectionCount: parsed.sectionCount,
    },
    pnach: parsed.text,
    parsed,
  };
}

export function loadCatalog(repo: string, releases: readonly Release[]): CatalogFeature[] {
  const directory: string = path.join(repo, CATALOG_PATH);
  if (!fs.existsSync(directory)) return [];
  let features: CatalogFeature[] = [];
  let ids: Set<string> = new Set();
  for (const name of fs
    .readdirSync(directory)
    .filter((name: string): boolean => name.endsWith(".json"))
    .sort()) {
    const rawDocument: unknown = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    let document: Record<string, unknown> = parseRecord(rawDocument, name);
    if (document["schemaVersion"] !== 1 || !Array.isArray(document["features"]))
      fail(`${name}: expected schemaVersion 1 and features array`);
    for (const rawEntry of parseArray(document["features"], `${name}.features`)) {
      let entry: Record<string, unknown> = parseRecord(rawEntry, `${name}.entry`);
      const id: string = parseText(entry["id"], `${name}.id`);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${id}: invalid stable feature ID`);
      if (["sheet", "unlockables", "faq", "tests", "prior-art"].includes(id)) fail(`${id}: reserved release page ID`);
      if (ids.has(id)) fail(`${id}: duplicate feature ID`);
      ids.add(id);
      if (entry["publication"] !== "draft" && entry["publication"] !== "published") fail(`${id}: publication must be draft or published`);
      if (entry["publication"] === "draft") continue;
      const kind: FeatureKind = parseFeatureKind(entry["kind"], id);
      const group: FeatureCategory = parseCategory(entry["category"], id);
      const title: string = parseText(entry["title"], `${id}.title`);
      let identity: Record<string, unknown> = parseRecord(entry["release"], `${id}.release`);
      let release: Release = requireValue(
        releases.find(
          (release: Release): boolean =>
            release.serial === identity["serial"] && release.crc === identity["crc"] && release.version === identity["version"],
        ),
        `${id}: unknown or mismatched release serial, version or CRC`,
      );
      let evidence: Record<string, unknown> = parseRecord(entry["evidence"], `${id}.evidence`);
      if (evidence["status"] !== "VERIFIED") fail(`${id}: published feature requires VERIFIED runtime evidence (S2-S6)`);
      const level: EvidenceLevel = parseRuntimeEvidenceLevel(evidence["level"], id);
      if (evidence["testedBuild"] !== `${release.serial}@${release.version}/${release.crc}`) fail(`${id}: evidence testedBuild mismatch`);
      const checked: string = parseText(evidence["result"], `${id}.evidence.result`);
      let sourceData: Record<string, unknown> = parseRecord(entry["source"], `${id}.source`);
      const revision: string = parseText(sourceData["revision"], `${id}.source.revision`);
      if (!/^[a-f0-9]{40}$/.test(revision)) fail(`${id}: source revision must be a full commit hash`);
      git(repo, ["merge-base", "--is-ancestor", revision, "HEAD"]);
      const source: Pin = parsePin(sourceData, revision, `${id}.source`);
      checkedFile(repo, source, revision, `${id}.source`);
      const controls: readonly string[] = parseTextList(entry["controls"], `${id}.controls`, { nonempty: true });
      const dependencies: readonly string[] = parseTextList(entry["dependencies"], `${id}.dependencies`);
      const conflicts: readonly string[] = parseTextList(entry["conflicts"], `${id}.conflicts`);
      const compatibilityNotes: readonly string[] = parseTextList(entry["compatibilityNotes"] ?? [], `${id}.compatibilityNotes`);
      const instructions: readonly string[] =
        entry["instructions"] === undefined ? [] : parseTextList(entry["instructions"], `${id}.instructions`, { nonempty: true });
      let lifecycleData: Record<string, unknown> = parseRecord(entry["lifecycle"], `${id}.lifecycle`);
      const lifecycle: Lifecycle = {
        enable: parseText(lifecycleData["enable"], `${id}.lifecycle.enable`),
        disable: parseText(lifecycleData["disable"], `${id}.lifecycle.disable`),
        reset: parseText(lifecycleData["reset"], `${id}.lifecycle.reset`),
        persistence: parseText(lifecycleData["persistence"], `${id}.lifecycle.persistence`),
      };
      const fields: CatalogFields = {
        id,
        title,
        group,
        effect: entry["description"] ? parseText(entry["description"], `${id}.description`) : checked,
        raw: [],
        pnach: null,
        status: "VERIFIED",
        level,
        checked,
        hardware: "NOT TESTED",
        controls,
        dependencies,
        conflicts,
        compatibilityNotes,
        lifecycle,
        instructions,
        source,
      };
      const url: string = `${release.url}${id}/`;
      switch (kind) {
        case "native-tip":
          parseTextList(entry["instructions"], `${id}.instructions`, { nonempty: true });
          if (entry["artifact"] || entry["raw"]) fail(`${id}: native tips cannot contain memory patches`);
          features.push({ ...fields, kind, artifact: null, release, url });
          break;
        case "simple-code": {
          const raw: readonly string[] = parseTextList(entry["raw"], `${id}.raw`, { nonempty: true, unique: false });
          if (raw.some((line: string): boolean => !/^[A-F0-9]{8} [A-F0-9]{8}$/.test(line))) fail(`${id}: invalid raw code`);
          if (/[\r\n\[\]]/.test(title)) fail(`${id}: title cannot be a patch directive`);
          let pnach: string = `gametitle=${release.serial} (${release.crc})\n\n[${title}]\n${raw.map((line: string): string => `patch=1,EE,${line.slice(0, 8)},extended,${line.slice(9)}`).join("\n")}\n`;
          let artifact: Artifact = {
            file: `${release.serial}_${release.crc}.${id}.pnach`,
            text: pnach,
            sha256: digest(pnach),
            sectionCount: 1,
          };
          if (entry["artifact"]) {
            let loaded: ModuleArtifact = moduleArtifact(repo, entry["artifact"], revision, release, id);
            const section: PnachSection = requireValue(loaded.parsed.sections[0], `${id}: patch section`);
            if (loaded.parsed.sectionCount !== 1 || section.raw.join("\n") !== raw.join("\n"))
              fail(`${id}: simple-code artifact differs from ordered raw lines`);
            if (section.patches.some((patch: string): boolean => !patch.startsWith("patch=1,")))
              fail(`${id}: simple-code artifact requires continuous patch=1 writes; use a compiled module for initialization patches`);
            pnach = loaded.pnach;
            artifact = loaded.artifact;
          }
          features.push({ ...fields, kind, raw, pnach, artifact, release, url });
          break;
        }
        case "compiled-module": {
          if (entry["raw"]) fail(`${id}: compiled modules cannot be flattened into raw codes`);
          let loaded: ModuleArtifact = moduleArtifact(repo, entry["artifact"], revision, release, id);
          features.push({ ...fields, kind, pnach: loaded.pnach, artifact: loaded.artifact, release, url });
          break;
        }
        default:
          assertNever(kind);
      }
    }
  }
  let byId: Map<string, CatalogFeature> = new Map(
    features.map((feature: CatalogFeature): [string, CatalogFeature] => [feature.id, feature]),
  );
  for (let feature of features) {
    if (feature.release.codes.some((code: Code): boolean => code.id === feature.id))
      fail(`${feature.id}: collides with an existing code page`);
    for (const reference of [...feature.dependencies, ...feature.conflicts]) {
      let target: CatalogFeature | undefined = byId.get(reference);
      if (!target || target === feature || target.release !== feature.release)
        fail(`${feature.id}: invalid, unpublished or cross-release reference ${reference}`);
    }
    if (feature.dependencies.some((id: string): boolean => feature.conflicts.includes(id)))
      fail(`${feature.id}: dependency also declared as a conflict`);
  }
  function visit(feature: CatalogFeature, selected: Set<string>, chain: ReadonlySet<string> = new Set()): void {
    if (chain.has(feature.id)) fail(`${feature.id}: circular dependency`);
    if (selected.has(feature.id)) return;
    selected.add(feature.id);
    for (const id of feature.dependencies) visit(requireValue(byId.get(id), id), selected, new Set([...chain, feature.id]));
  }
  for (let feature of features) {
    let selected: Set<string> = new Set();
    visit(feature, selected);
    for (const id of selected) {
      const conflict: string | undefined = requireValue(byId.get(id), id).conflicts.find((target: string): boolean => selected.has(target));
      if (conflict) fail(`${feature.id}: required feature set contains conflicting entries ${id} and ${conflict}`);
    }
  }
  return features;
}
