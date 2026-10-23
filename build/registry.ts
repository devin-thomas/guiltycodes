import YAML from "yaml";
import { array, list, number, record, text } from "./validate.ts";
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
  readonly reg: {
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
  let reg: Record<string, unknown> = record(raw, "registry");
  let release: Record<string, unknown> = record(reg["release"], "registry release");
  let elf: Record<string, unknown> = record(release["elf"], "registry ELF");
  let disc: Record<string, unknown> = record(release["disc"], "registry disc");
  let env: Record<string, unknown> = record(reg["test_environment"], "registry environment");
  let levels: Record<string, unknown> = record(reg["evidence_levels"], "evidence levels");
  const evidenceLevels: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(levels).map(([key, value]: [string, unknown]): [string, string] => [key, text(value, key)]),
  );
  const findings: readonly unknown[] = array(reg["findings"], "registry findings");
  let published: PublishedFinding[] = [];
  let derived: Map<string, DerivedFinding> = new Map();
  let releasePins: ReleasePin[] = [];
  let claims: unknown[] = [];
  for (const rawFinding of findings) {
    let f: Record<string, unknown> = record(rawFinding, "finding");
    const kind: string = text(f["claim_kind"], "claim_kind");
    if (kind === "derived-code" && f["title"] === undefined) {
      text(f["cheat_file"], "ported-code cheat file");
      continue;
    }
    if (kind === "published-code" || kind === "derived-code") {
      const finding: DerivedFinding = {
        finding_id: text(f["finding_id"], "finding_id"),
        title: text(f["title"], "title"),
        raw_code: list(f["raw_code"], "raw_code", { unique: false }),
        evidence_level: parseEvidenceLevel(f["evidence_level"]),
      };
      if (kind === "derived-code") derived.set(finding.title, finding);
      else
        published.push({
          ...finding,
          source_date: text(f["source_date"], "source_date"),
          conflicts_with: list(f["conflicts_with"] ?? [], "conflicts_with"),
          generated_pnach: list(f["generated_pnach"], "generated_pnach", { unique: false }),
          provenance_note: typeof f["provenance_note"] === "string" ? f["provenance_note"] : text(f["provenance_note"], "provenance_note"),
          source_author: text(f["source_author"], "source_author"),
          source_url: text(f["source_url"], "source_url"),
          ...(f["source_archive"] === undefined ? {} : { source_archive: text(f["source_archive"], "source_archive") }),
          ...(f["source_mirror"] === undefined ? {} : { source_mirror: text(f["source_mirror"], "source_mirror") }),
        });
    } else if (kind === "release")
      releasePins.push({
        serial: text(f["serial"], "serial"),
        elf_crc: text(f["elf_crc"], "elf_crc"),
        game_version: text(f["game_version"], "game_version"),
        elf_sha256: text(f["elf_sha256"], "elf_sha256"),
        redump_id: number(f["redump_id"], "redump_id"),
        disc_crc32: text(f["disc_crc32"], "disc_crc32"),
        disc_sha1: text(f["disc_sha1"], "disc_sha1"),
      });
    else if (kind === "published-claim") claims.push(rawFinding);
  }
  return {
    reg: {
      release: {
        elf: {
          pcsx2_crc: text(elf["pcsx2_crc"], "pcsx2_crc"),
          name: text(elf["name"], "ELF name"),
          size: number(elf["size"], "ELF size"),
          sha256: text(elf["sha256"], "ELF sha256"),
        },
        disc: {
          redump_url: text(disc["redump_url"], "redump_url"),
          crc32: text(disc["crc32"], "disc crc32"),
          sha1: text(disc["sha1"], "disc sha1"),
          size: number(disc["size"], "disc size"),
          exe_date: text(disc["exe_date"], "exe_date"),
        },
      },
      test_environment: {
        emulator: text(env["emulator"], "emulator"),
        hardware_devices: text(env["hardware_devices"], "hardware_devices"),
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
