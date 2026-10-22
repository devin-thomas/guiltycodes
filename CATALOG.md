# Evidence-pinned feature catalog

The existing cheat-document adapter still builds its original releases and pages.
Additional features are opt-in JSON files in the research repository at
`games/guiltycodes/catalog/*.json`. No other directory is scanned for new codes.

Each file has `schemaVersion: 1` and a `features` array. Use one file per feature
or related set. IDs are unique, stable kebab-case identifiers across all files.

```json
{
  "schemaVersion": 1,
  "features": [
    {
      "id": "acplus-us-training-example",
      "title": "Training example",
      "description": "A concise description of the player's resulting experience.",
      "kind": "native-tip",
      "category": "Training",
      "publication": "published",
      "release": {
        "serial": "SLUS-21847",
        "crc": "F233A433",
        "version": "1.00"
      },
      "source": {
        "revision": "FULL_40_CHARACTER_GIT_COMMIT",
        "path": "games/example/EVIDENCE.md",
        "sha256": "SHA256_OF_EVIDENCE_FILE_BYTES"
      },
      "evidence": {
        "status": "VERIFIED",
        "level": "S2",
        "result": "The exact observed runtime result, including the limits of the test.",
        "testedBuild": "SLUS-21847@1.00/F233A433"
      },
      "controls": ["The exact buttons or menu choices"],
      "dependencies": [],
      "conflicts": [],
      "lifecycle": {
        "enable": "How to enable the feature",
        "disable": "How to disable it, including any reboot requirement",
        "reset": "How to recover the normal state",
        "persistence": "Whether it survives a round, reboot or save"
      },
      "instructions": ["The first step", "The next step"]
    }
  ]
}
```

`description` is optional; its fallback is the measured evidence result. All
other fields above are required for a published native tip. Categories are
`Native shortcuts`, `Survival`, `Training`, `CPU and controls`, `Match rules`,
`Presentation`, `Unlocks`, and `Utilities`.

Kinds have different payloads:

- `native-tip`: requires a nonempty `instructions` array. Has no `raw` or
  `artifact`, and creates no cheat file.
- `simple-code`: requires nonempty `raw`, an array of uppercase eight-digit
  address/value pairs, for example `"20123450 00000001"`. The build produces a
  separate, named PNACH file containing this code, with its SHA-256. An optional
  pinned `artifact` can instead supply the exact download bytes; it must have
  exactly one section and exactly the same ordered raw writes.
  Repeated writes and repeated extended-code conditions retain their original
  order. Simple-code artifacts use continuous `patch=1` lines; boot-only
  `patch=0` initialization belongs in a compiled module.
- `compiled-module`: requires `artifact: {"path":
  "games/guiltycodes/artifacts/example.pnach", "sha256": "..."}`. Has no
  `raw`. Its full artifact is copied byte-for-byte, with the same SHA-256.
  The PNACH `gametitle` must contain the exact serial and CRC. Every section
  needs patches, and patches use `patch=0` or `patch=1` with EE extended codes.

Only entries explicitly marked `publication: "published"` can reach the site.
Drafts need only `id` and `publication: "draft"`; unfinished draft payloads are
ignored and their artifacts cannot appear in downloads or search.

Published entries must have `VERIFIED` runtime evidence at S2-S6, a release
already supported by the site with matching serial, CRC and version, and an
exact matching `testedBuild` string. S1/static findings stay drafts.

Commit evidence and module artifacts in the research repo **before** pinning
the catalog entry. The full `source.revision` must be an ancestor of the
research checkout's HEAD. Both the evidence file and any module artifact must
match their checksums and their bytes at that commit. Modified, stale,
uncommitted, missing or out-of-repository source files fail the build before
the previous output is replaced. A source revision is not a live branch name.

`dependencies` and `conflicts` reference other published feature IDs for the
same release. Unknown, draft, self-referential and cross-release references
fail validation, as do circular dependencies and a feature simultaneously
requiring and conflicting with another feature. A dependency is a mandatory
download or step; describe optional alternatives in the lifecycle text.
The full dependency closure must also be compatible: a feature cannot require
two modules that conflict with each other, even through indirect dependencies.
Optional `compatibilityNotes: ["..."]` describes limitations or conflicts with
external mods that have no published catalog entry.

The catalog adds feature pages, searchable rows, and named downloads to the
existing site. Module patches are never flattened into the raw cheat sheet.
Feature-page counts and downloadable patch-section counts are separate: a
native tip is one page and zero patch sections; a complete module can be one
page and several patch sections. Download indexes contain `featureId`,
`featurePages`, `patchSections`, and module `sha256` rather than treating every
section as a separate feature.

Run the adapter and legacy catalog regression tests together:

```sh
RETRO_REPO=/path/to/retro-graphics-research npm test
RETRO_REPO=/path/to/retro-graphics-research npm run build
```

Without `RETRO_REPO`, `npm test` still runs the isolated manifest tests and
explicitly skips the regression that requires the research checkout.
