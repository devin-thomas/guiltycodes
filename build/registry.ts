import YAML from "yaml";
import { parseArray, parseNumber, parseRecord, parseText, parseTextList } from "./validate.ts";
import type { EvidenceLevel } from "./model.ts";

export type DerivedFinding = {
  readonly finding_id: string;
  readonly title: string;
  readonly raw_code: readonly string[];
  readonly evidence_level: EvidenceLevel;
};
export type PublishedFinding = DerivedFinding & {
  readonly source_date: string;
  readonly conflicts_with: readonly string[];
  readonly generated_pnach: readonly string[];
  readonly provenance_note: string;
  readonly source_author: string;
  readonly source_url: string;
  readonly source_archive?: string;
  readonly source_mirror?: string;
};
export type ReleasePin = {
  readonly serial: string;
  readonly elf_crc: string;
  readonly game_version: string;
  readonly elf_sha256: string;
  readonly redump_id: number;
  readonly disc_crc32: string;
  readonly disc_sha1: string;
};
export type Registry = {
  readonly metadata: {
    readonly release: {
      readonly elf: { readonly pcsx2_crc: string; readonly name: string; readonly size: number; readonly sha256: string };
      readonly disc: {
        readonly redump_url: string;
        readonly crc32: string;
        readonly sha1: string;
        readonly size: number;
        readonly exe_date: string;
      };
    };
    readonly test_environment: { readonly emulator: string; readonly hardware_devices: string };
    readonly evidence_levels: Readonly<Record<string, string>>;
  };
  readonly published: readonly PublishedFinding[];
  readonly derived: ReadonlyMap<string, DerivedFinding>;
  readonly releasePins: readonly ReleasePin[];
  readonly claims: readonly unknown[];
  readonly count: number;
};
export function parseEvidenceLevel(value: unknown): EvidenceLevel {
  if (value === "S0" || value === "S1" || value === "S2" || value === "S3" || value === "S4" || value === "S5" || value === "S6")
    return value;
  throw new Error("Invalid evidence level");
}
export function parseRegistry(source: string): Registry {
  const raw: unknown = YAML.parse(source);
  let registry: Record<string, unknown> = parseRecord(raw, "registry");
  let release: Record<string, unknown> = parseRecord(registry["release"], "registry release");
  let elf: Record<string, unknown> = parseRecord(release["elf"], "registry ELF");
  let disc: Record<string, unknown> = parseRecord(release["disc"], "registry disc");
  let environment: Record<string, unknown> = parseRecord(registry["test_environment"], "registry environment");
  let levels: Record<string, unknown> = parseRecord(registry["evidence_levels"], "evidence levels");
  const evidenceLevels: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(levels).map(([key, value]: [string, unknown]): [string, string] => [key, parseText(value, key)]),
  );
  const findings: readonly unknown[] = parseArray(registry["findings"], "registry findings");
  let published: PublishedFinding[] = [];
  let derived: Map<string, DerivedFinding> = new Map();
  let releasePins: ReleasePin[] = [];
  let claims: unknown[] = [];
  for (const rawFinding of findings) {
    let entry: Record<string, unknown> = parseRecord(rawFinding, "finding");
    const claimKind: string = parseText(entry["claim_kind"], "claim_kind");
    if (claimKind === "derived-code" && entry["title"] === undefined) {
      parseText(entry["cheat_file"], "ported-code cheat file");
      continue;
    }
    if (claimKind === "published-code" || claimKind === "derived-code") {
      const finding: DerivedFinding = {
        finding_id: parseText(entry["finding_id"], "finding_id"),
        title: parseText(entry["title"], "title"),
        raw_code: parseTextList(entry["raw_code"], "raw_code", { unique: false }),
        evidence_level: parseEvidenceLevel(entry["evidence_level"]),
      };
      if (claimKind === "derived-code") derived.set(finding.title, finding);
      else
        published.push({
          ...finding,
          source_date: parseText(entry["source_date"], "source_date"),
          conflicts_with: parseTextList(entry["conflicts_with"] ?? [], "conflicts_with"),
          generated_pnach: parseTextList(entry["generated_pnach"], "generated_pnach", { unique: false }),
          provenance_note:
            typeof entry["provenance_note"] === "string"
              ? entry["provenance_note"]
              : parseText(entry["provenance_note"], "provenance_note"),
          source_author: parseText(entry["source_author"], "source_author"),
          source_url: parseText(entry["source_url"], "source_url"),
          ...(entry["source_archive"] === undefined ? {} : { source_archive: parseText(entry["source_archive"], "source_archive") }),
          ...(entry["source_mirror"] === undefined ? {} : { source_mirror: parseText(entry["source_mirror"], "source_mirror") }),
        });
    } else if (claimKind === "release")
      releasePins.push({
        serial: parseText(entry["serial"], "serial"),
        elf_crc: parseText(entry["elf_crc"], "elf_crc"),
        game_version: parseText(entry["game_version"], "game_version"),
        elf_sha256: parseText(entry["elf_sha256"], "elf_sha256"),
        redump_id: parseNumber(entry["redump_id"], "redump_id"),
        disc_crc32: parseText(entry["disc_crc32"], "disc_crc32"),
        disc_sha1: parseText(entry["disc_sha1"], "disc_sha1"),
      });
    else if (claimKind === "published-claim") claims.push(rawFinding);
  }
  return {
    metadata: {
      release: {
        elf: {
          pcsx2_crc: parseText(elf["pcsx2_crc"], "pcsx2_crc"),
          name: parseText(elf["name"], "ELF name"),
          size: parseNumber(elf["size"], "ELF size"),
          sha256: parseText(elf["sha256"], "ELF sha256"),
        },
        disc: {
          redump_url: parseText(disc["redump_url"], "redump_url"),
          crc32: parseText(disc["crc32"], "disc crc32"),
          sha1: parseText(disc["sha1"], "disc sha1"),
          size: parseNumber(disc["size"], "disc size"),
          exe_date: parseText(disc["exe_date"], "exe_date"),
        },
      },
      test_environment: {
        emulator: parseText(environment["emulator"], "emulator"),
        hardware_devices: parseText(environment["hardware_devices"], "hardware_devices"),
      },
      evidence_levels: evidenceLevels,
    },
    published,
    derived,
    releasePins,
    claims,
    count: findings.length,
  };
}
