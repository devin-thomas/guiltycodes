export type Status = "VERIFIED" | "INFERRED" | "NOT TESTED" | "SUPERSEDED";
export type EvidenceLevel = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
export type FeatureKind = "native-tip" | "simple-code" | "compiled-module";
export type FeatureCategory =
  | "Native shortcuts"
  | "Survival"
  | "Training"
  | "CPU and controls"
  | "Match rules"
  | "Presentation"
  | "Unlocks"
  | "Utilities";
export type CodeGroup =
  | FeatureCategory
  | "Everything"
  | "Characters and modes"
  | "EX characters"
  | "Gold, black and SP colours"
  | "Progress"
  | "Stages"
  | "Passwords"
  | "lee4, 2014"
  | "lee4, 2009 (superseded)";
export type GameId = "x" | "xx" | "reload" | "slash" | "ac" | "acplus" | "isuka";
export type Counts = Readonly<Record<Status, number>>;
export type Table = { readonly header: readonly string[]; readonly rows: ReadonlyArray<readonly string[]>; readonly text: string };
export type PnachSection = {
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly patches: readonly string[];
  readonly text: string;
  readonly raw: readonly string[];
};
export type ParsedPnach = {
  readonly header: { readonly gametitle: string; readonly comments: readonly string[] };
  readonly sections: readonly PnachSection[];
};
export type Pin = { readonly path: string; readonly sha256: string; readonly revision: string };
export type Artifact = {
  readonly file: string;
  readonly text: string | Uint8Array;
  readonly sha256: string;
  readonly sectionCount: number;
};
export type Lifecycle = { readonly enable: string; readonly disable: string; readonly reset: string; readonly persistence: string };
export type Published = {
  readonly author: string;
  readonly date: string;
  readonly url?: string;
  readonly archive?: string;
  readonly mirror?: string;
  readonly year: string;
};
export type CodeFields = {
  readonly id: string;
  readonly title: string;
  readonly shortTitle?: string;
  readonly group: CodeGroup;
  readonly effect: string;
  readonly raw: readonly string[];
  readonly rawKind?: "buttons" | "password";
  readonly pnach: string | null;
  readonly author?: string;
  readonly status: Status;
  readonly statusNote?: string;
  readonly level: EvidenceLevel | null;
  readonly checked: string;
  readonly hardware: Status;
  readonly regId?: string;
  readonly published?: Published;
  readonly mateId?: string | null;
  readonly inputNote?: string;
  readonly credit?: string | null;
};
export type LegacyCode = CodeFields & { readonly kind?: undefined; readonly artifact?: undefined };
export type CatalogFields = CodeFields & {
  readonly controls: readonly string[];
  readonly dependencies: readonly string[];
  readonly conflicts: readonly string[];
  readonly compatibilityNotes: readonly string[];
  readonly lifecycle: Lifecycle;
  readonly instructions: readonly string[];
  readonly source: Pin;
};
export type NativeTip = CatalogFields & { readonly kind: "native-tip"; readonly artifact: null };
export type SimpleCode = CatalogFields & { readonly kind: "simple-code"; readonly artifact: Artifact };
export type CompiledModule = CatalogFields & { readonly kind: "compiled-module"; readonly artifact: Artifact };
export type CodeDraft = LegacyCode | NativeTip | SimpleCode | CompiledModule;
export type Code = CodeDraft & { readonly release: Release; readonly url: string };
export type CatalogFeature = (NativeTip | SimpleCode | CompiledModule) & { readonly release: Release; readonly url: string };
export type AcplusUnlock = { readonly kind: "acplus"; readonly jp?: boolean; readonly append?: boolean };
export type X2Unlock = { readonly kind: "x2" };
export type FamilyUnlock = { readonly kind: "family"; readonly mapKey: string; readonly rowRe: RegExp };
export type XUnlock = { readonly kind: "x"; readonly md: string };
export type XplusUnlock = {
  readonly kind: "xplus";
  readonly md: string;
  readonly dirTable: Table;
  readonly levelNote: string;
  readonly faqLink: string;
};
export type IsukaUnlock = { readonly kind: "isuka"; readonly md: string };
export type TaikenbanUnlock = { readonly kind: "taikenban"; readonly md: string };
export type Unlock = AcplusUnlock | X2Unlock | FamilyUnlock | XUnlock | XplusUnlock | IsukaUnlock | TaikenbanUnlock;
export type ReleaseInput = {
  readonly gameId: GameId;
  readonly slug?: string;
  readonly label: string;
  readonly serial: string;
  readonly version: string;
  readonly crc: string;
  readonly elf?: { readonly name: string; readonly size?: number; readonly sha256: string };
  readonly disc?: {
    readonly redump: string;
    readonly crc32: string;
    readonly sha1: string;
    readonly size?: number;
    readonly date?: string;
  };
  readonly imageInfo?: string;
  readonly pnachFile: string | null;
  readonly pnachText: string | null;
  readonly codes: readonly CodeDraft[];
  readonly hasLee4?: boolean;
  readonly unlock: Unlock;
  readonly note?: string | null;
  readonly famName?: string;
};
export type GameDefinition = { readonly id: GameId; readonly title: string; readonly short: string; readonly slug: string };
export type Game = GameDefinition & { readonly releases: readonly Release[] };
export type Release = Omit<ReleaseInput, "slug" | "codes"> & {
  readonly slug: string;
  readonly region: string;
  readonly regionShort: string;
  codes: Code[];
  counts: Counts;
  patchSections: number;
  readonly game: GameDefinition;
  readonly url: string;
};
export type Shared = {
  readonly priorWork: string;
  readonly sourcesTable: Table;
  readonly lee4Where: Table;
  readonly lee4Tests: Table;
  readonly masterCode: string;
  readonly sideEffect: string;
  readonly verdict: string;
  readonly playTime: Table;
  readonly timeSep: string;
  readonly stageTable: Table;
  readonly stageFlags: Table;
  readonly stageStates: Table;
  readonly fieldMap: Table;
  readonly quickStart: Table;
  readonly charactersMd: string;
  readonly caveatsMd: string;
  readonly howTo: string;
  readonly accept: string;
  readonly jpDoc: string;
  readonly jpRuntime: Table;
  readonly jpSingle: string;
  readonly jpAppend: string;
  readonly guideClaims: string;
  readonly verification: Table;
  readonly testSetup: ReadonlyArray<readonly [string, string]>;
  readonly famMaps: Readonly<Record<string, string>>;
  readonly famRows: ReadonlyArray<readonly string[]>;
  readonly x2Doc: string;
  readonly famDoc: string;
  readonly othDoc: string;
  readonly acDoc: string;
  readonly evidenceLevels: Readonly<Record<string, string>>;
  readonly claims: readonly unknown[];
  readonly registryCount: number;
  readonly commit: string;
};
export type Site = {
  readonly games: readonly Game[];
  readonly releases: readonly Release[];
  readonly shared: Shared;
  readonly GROUPS: readonly CodeGroup[];
  readonly features: readonly CatalogFeature[];
  built: string;
  priorMap: Map<string, string>;
};
export type Download = {
  readonly file: string;
  readonly release: Release;
  readonly text: string | Uint8Array;
  readonly sectionCount: number;
  readonly feature?: Code;
  readonly sha256?: string;
};

export function assertNever(_value: never): never {
  throw new Error("Unexpected union variant");
}

export function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${label}`);
  return value;
}

export function countCodes(codes: readonly CodeDraft[]): Counts {
  return {
    VERIFIED: codes.filter((code: CodeDraft): boolean => code.status === "VERIFIED").length,
    INFERRED: codes.filter((code: CodeDraft): boolean => code.status === "INFERRED").length,
    "NOT TESTED": codes.filter((code: CodeDraft): boolean => code.status === "NOT TESTED").length,
    SUPERSEDED: codes.filter((code: CodeDraft): boolean => code.status === "SUPERSEDED").length,
  };
}
