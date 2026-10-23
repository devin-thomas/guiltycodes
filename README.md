# Guilty Codes

Cheat codes for the Guilty Gear PS2 games, in the style of a pre-2009 cheat site. Live at https://guiltycodes.pages.dev.

Static site. `build.mjs` reads the cheat docs and writes `dist/`.

## Build

```sh
git clone --branch guilty-codes-delivery --single-branch \
  https://github.com/devin-thomas/retro-graphics-research.git /path/to/cheat-docs
export RETRO_REPO=/path/to/cheat-docs
npm install
npm test             # adapter checks and full source-catalog regression
npm run build        # writes dist/
npm run deploy       # build, then wrangler pages deploy (project: guiltycodes)
```

The source docs are read from `RETRO_REPO=/path/to/cheat-docs` or `node build.mjs --source /path/to/cheat-docs`. They are only read.

Use the published research branch `guilty-codes-delivery` for the complete
feature catalog. The research repository's `main` branch does not contain the
required ggmod source and accepted module catalog. Research commit
`33eb61427d11d3416ffc5c9dc27785fcfbe340bf` is the precursor baseline, rather than
the complete release. Current release reference: `2da211e15b56548fd23d851fb5a9dc2a47c4d75d`
(combined CPU Arcade/M.O.M./Survival v1, including its qualified source and exact
release artifact, plus corrected Respect/Dust palette instructions).
Standalone CPU Survival v1 remains available from the previous release
`81081dd1f1bac0738e611b22d71b2c9beaca4f54`.
The previous eight-issue delivery reference is
`830db45434311fc7fdd8954e583bd400b3e2c49c`.
Each published manifest also pins its own evidence and artifact source revision;
the build verifies those pins without requiring a separate source lockfile.

First deploy: `npx wrangler login`, then `npx wrangler pages project create guiltycodes --production-branch main`. With more than one Cloudflare account, set `CLOUDFLARE_ACCOUNT_ID`.

## Downloads and releases

The build writes each scrubbed `.pnach` to `dist/pnach/`, a zip of all of them to `dist/downloads/guiltycodes-pnach.zip`, the `/downloads/` page, and a committed copy in `pnach/` (with `pnach/index.json`). Commit `pnach/` after a build that changes it.

Feature-page download buttons suggest `SERIAL_CRC.pnach`, the filename PCSX2
expects. Archive URLs and the all-files zip keep feature-specific names so
alternative modules remain distinct. Follow the individual feature's setup and
conflict instructions; do not install the entire zip as one active cheat set.

To publish a GitHub release, push a date tag; `.github/workflows/release.yml` attaches every `pnach/*.pnach` and the zip:

```sh
git tag v2026.10.19 && git push origin v2026.10.19
```

## What is generated, and from where

| Page content | Source |
|---|---|
| Accent Core Plus US codes (raw, PCSX2, status, level) | the AC+ `.pnach`, `registry.yaml` and the test matrix in its `CHEATS.md` |
| lee4 2014 and 2009 codes, credits, SE/VOICE warning | the registry's published codes and the prior-work tables in `CHEATS.md` |
| Accent Core Plus JP and Append | the two `jp/*.pnach` files and the JP section of `CHEATS.md` |
| X2 US | the X2 `CHEATS.md` and `.pnach` |
| Accent Core US, Slash JP, #Reload KR/JP, GGXX JP | `FAMILY.md` and one `.pnach` per release |
| X US title-screen code, X Plus passwords, Isuka | `OTHER_DISCS.md` |
| Native unlock methods, stage tables, test logs | the same docs, extracted by heading or table |

A re-run picks up new codes: every `[section]` in a pnach becomes a code page. The build stops with an error when a pnach section has no registry or matrix row, when the registry and pnach raw codes differ, or when a release identity (serial, CRC) does not match the docs.

New native tips, simple codes, and complete compiled modules use the explicit
[evidence-pinned feature catalog](CATALOG.md). Drafts stay out of the public
model. Runtime evidence, source revision, release identity, checksums, controls,
dependencies, conflicts, and recovery instructions are validated before a build
replaces the previous output. Feature pages and downloadable patch sections
are counted separately; modules retain their complete download structure.

Statuses come from the docs' own tables. Releases tested only by prose (FAMILY.md) are mapped to their table rows in `build/data.mjs`; a code without a row is INFERRED.

Left out on purpose: routine and jump-table addresses, script names, evidence-capture paths, and the asset-hash comparison of stage art. The build scrubs them from extracted text (`scrub` in `build/lib.mjs`).

No game binaries, extracted assets, or decompilation material are in this repo or on the site.

## Look and feel: what was studied

Wayback Machine captures, viewed in 2026-10 (pre-2009 pages only; the Wayback Machine serves the capture nearest the requested year):

- CheatCC (Cheat Code Central), `cheatcc.com`, capture of 2007-12-31: top platform strip, boxed left nav with red links on grey, "Top Cheats / Latest Reviews" tabs.
- GameFAQs, `gamefaqs.com` home (capture of 2008-02-18) and a game's Cheats page (`/console/ps2/code/459841.html`, 2008): blue banner, Home / Data / FAQs / Cheats tab strip, purple table headers, zebra rows, "Unlockables" table with a header bar.
- GameWinners, `gamewinners.com` (2007) and its PlayStation2 channel page: olive boxes with centred caps headers, CHANNELS side box, uppercase nav.
- GameShark, `gameshark.com` (home page dated 2007-10-29): black chrome, grey side menu with a CHANNELS list, small white-on-black type, shark badge art.
- GameHacking.org, `gamehacking.org`: the 2008 capture returned a parked-domain page, so it was not used for layout. Its role here is credit only.
- Shoryuken, `shoryuken.com` (capture with the post of 2007-12-06): blue header, white tabs (Blog, Wiki, Forums), narrow reading column.
- Dustloop, `dustloop.com` (2008): the forums/guides splash. The forum capture returned a modern page and was not used.
- Arc System Works, `arcsystemworks.jp` (news dated 2008-12-29): red gradient frame, boxed information panel, banner stack. `guiltygear.com` returned an almost empty page for 2007.

Taken from them: dense 11px tables, a left sidebar of boxed link lists, tab strips, 88x31 button badges, header bars with slanted ends.

Guilty Gear XX's menus and HUD set the colours (black, crimson, steel grey, gold), the slanted frames, the segmented life-bar look used for the verified-count gauges, and the stepped meter used for evidence levels. These are CSS and SVG drawn for this site. The logo is SVG text in Anton (SIL OFL, `@fontsource/anton`). No ripped sprites, stage art, logos or fonts.

## Background

[`@uppercut-labs/dreamcast-backgrounds`](https://www.npmjs.com/package/@uppercut-labs/dreamcast-backgrounds) 0.1.0, scene `vector-dojo-showdown`, bundled by esbuild into `assets/bg.js` and loaded after the page is ready. It needs WebGL2 and falls back to the package poster. Panels stay opaque for readability; `prefers-reduced-motion` stops the animation, phones get the low quality mode, and a footer toggle turns it off (remembered in localStorage). The package's LICENSE and NOTICE ship in `assets/`.

## Footer branding

Uppercut Labs logo (the original brand image), downscaled from 1254 to 128 px with Lanczos and nothing else (`src/uppercut-labs-logo.png`; no rounding, masks or cropping). The GitHub and X marks are the official icons from `simple-icons`, read at build time. Links: uppercut-labs.com, github.com/devin-thomas, x.com/gohan__fgc.

## Layout

```
build.mjs          orchestrates the build, writes dist/
build/lib.mjs      markdown slicing, table parsing, pnach parsing, scrubbing
build/data.mjs     reads the repo docs into games > releases > codes
build/render.mjs   HTML templates
src/               site.css, site.js, bg.js
```
