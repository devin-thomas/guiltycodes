// HTML templates. Everything visible is either generated from the source docs or a short label.
import { siGithub, siX } from "simple-icons";
import type { SimpleIcon } from "simple-icons";
import { patchInstallHtml, patchInstallSummary, patchSetupText } from "./install.ts";
import { assertNever, requireValue, STATUS_ORDER } from "./model.ts";
import type {
  Code,
  CodeGroup,
  Counts,
  Download,
  EvidenceLevel,
  Game,
  GameId,
  Lifecycle,
  Published,
  Release,
  Shared,
  Site,
  Status,
  Table,
  Unlock,
} from "./model.ts";
import {
  escapeHtml,
  markdownHtml,
  inlineMarkdownHtml,
  tableMarkdown,
  stripMarkdown,
  slugify,
  sectionBody,
  textBetween,
  parseTables,
} from "./lib.ts";
import { FEATURE_CATEGORIES } from "./catalog.ts";

/** The part of the site model a page shell and code page read. */
export type PageSite = Pick<Site, "games" | "built" | "priorMap">;
type Crumb = { readonly label: string; readonly href?: string; readonly game?: GameId };
type ShellOptions = {
  readonly title: string;
  readonly description: string;
  readonly site: PageSite;
  readonly crumbs?: readonly Crumb[];
  readonly body: string;
  readonly isWide?: boolean;
};
type Neighbors = { readonly previous?: Code | undefined; readonly next?: Code | undefined };
type ReleaseTab = readonly [path: string, label: string];
type LabelledValue = readonly [label: string, html: string];
type PublishedCode = Code & { readonly published: Published };
type ReleaseUnlockCode = { readonly release: Release; readonly code: Code };

export const GROUP_ORDER: readonly CodeGroup[] = [
  "Everything",
  "Characters and modes",
  "EX characters",
  "Gold, black and SP colours",
  "Progress",
  "Stages",
  "Passwords",
  "lee4, 2014",
  "lee4, 2009 (superseded)",
  ...FEATURE_CATEGORIES,
];

function totalCounts(releases: readonly Release[]): Counts {
  return {
    VERIFIED: releases.reduce((total: number, release: Release): number => total + release.counts.VERIFIED, 0),
    INFERRED: releases.reduce((total: number, release: Release): number => total + release.counts.INFERRED, 0),
    "NOT TESTED": releases.reduce((total: number, release: Release): number => total + release.counts["NOT TESTED"], 0),
    SUPERSEDED: releases.reduce((total: number, release: Release): number => total + release.counts.SUPERSEDED, 0),
  };
}

function cssClass(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

function statusBadge(status: Status): string {
  return `<span class="st st-${cssClass(status)}">${escapeHtml(status)}</span>`;
}

function levelMeter(level: EvidenceLevel | null): string {
  if (!level) return `<span class="lv lv-none" title="No evidence level recorded">&ndash;</span>`;
  const rank: number = Number(level[1]);
  return `<span class="lv" title="${escapeHtml(level)}"><span class="segs" aria-hidden="true">${Array.from({ length: 7 }, (_: unknown, index: number): string => `<i${index <= rank ? ' class="on"' : ""}></i>`).join("")}</span><b>${escapeHtml(level)}</b></span>`;
}

function verifiedGauge(counts: Counts, total: number): string {
  const verified: number = counts.VERIFIED ?? 0;
  if (!total) return `<span class="gauge empty" aria-label="No codes"><span class="gtxt">no codes</span></span>`;
  const percent: number = Math.round((verified / total) * 100);
  return `<span class="gauge" role="img" aria-label="${verified} of ${total} verified"><span class="gfill" style="width:${percent}%"></span><span class="gtxt">${verified}/${total}</span></span>`;
}

// ---------- 88x31 button badges ----------
function buttonBadge(top: string, bottom: string, topColor: string, bottomColor: string, href: string, label: string): string {
  const svg: string = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="31" viewBox="0 0 88 31" role="img" aria-label="${escapeHtml(label)}"><defs><linearGradient id="b${escapeHtml(slugify(top + bottom))}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${topColor}"/><stop offset="1" stop-color="${bottomColor}"/></linearGradient></defs><rect x=".5" y=".5" width="87" height="30" fill="url(#b${escapeHtml(slugify(top + bottom))})" stroke="#000"/><rect x="1.5" y="1.5" width="85" height="28" fill="none" stroke="rgba(255,255,255,.35)"/><text x="44" y="13" text-anchor="middle" font-family="Verdana,Tahoma,sans-serif" font-size="9" font-weight="bold" fill="#fff" stroke="#000" stroke-width=".6" paint-order="stroke">${escapeHtml(top)}</text><text x="44" y="25" text-anchor="middle" font-family="Verdana,Tahoma,sans-serif" font-size="8" fill="#fff" stroke="#000" stroke-width=".5" paint-order="stroke">${escapeHtml(bottom)}</text></svg>`;
  return `<a class="btn88" href="${href}"${/^https?:/.test(href) ? ' rel="noopener noreferrer"' : ""} title="${escapeHtml(label)}">${svg}</a>`;
}

function buttonBadges(): string {
  return [
    buttonBadge("PCSX2", ".pnach", "#3a7bd5", "#12294f", "/how-to/", "How to use the PCSX2 files"),
    buttonBadge("lee4", "2014 + 2009", "#d42a3a", "#5a0a12", "/credits/#lee4", "lee4 credit"),
    buttonBadge("GameHacking", ".org", "#2a9d6a", "#0d3b28", "/credits/#gamehacking", "GameHacking.org credit"),
    buttonBadge("Dustloop", "credit", "#b5481d", "#4b1a08", "/credits/#dustloop", "Dustloop credit"),
    buttonBadge("S0 - S6", "evidence", "#c79b27", "#4d3a0b", "/credits/#evidence-levels", "Evidence levels"),
  ].join("");
}

function iconSvg(icon: SimpleIcon): string {
  return `<svg class="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${icon.path}"/></svg>`;
}

// ---------- page shell ----------
const LOGO: string = `<svg xmlns="http://www.w3.org/2000/svg" class="logo" viewBox="0 0 400 66" role="img" aria-label="Guilty Codes"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".48" stop-color="#ffd9d9"/><stop offset=".5" stop-color="#ff2b3d"/><stop offset="1" stop-color="#6a0610"/></linearGradient></defs><g transform="skewX(-12) translate(18 0)"><text x="0" y="52" font-family="Anton,Impact,'Arial Narrow',sans-serif" font-size="56" letter-spacing="2" fill="url(#lg)" stroke="#000" stroke-width="7" paint-order="stroke" stroke-linejoin="round">GUILTY CODES</text></g><path d="M6 61 L392 14" stroke="#e6b43c" stroke-width="2.5" opacity=".9"/><path d="M6 64 L392 17" stroke="#000" stroke-width="1" opacity=".7"/></svg>`;

function shell({ title, description, site, crumbs = [], body, isWide = false }: ShellOptions): string {
  let games: readonly Game[] = site.games;
  const currentGame: GameId | undefined = crumbs.find((crumb: Crumb): boolean => crumb.game !== undefined)?.game;
  const sideList: string = games
    .map((game: Game): string => {
      const isOpen: boolean = currentGame === game.id;
      return `<li${isOpen ? ' class="open"' : ""}><a href="/games/${game.slug}/">${escapeHtml(game.title)}</a>${
        isOpen
          ? `<ul>${game.releases.map((release: Release): string => `<li><a href="${release.url}">${escapeHtml(release.label)} <small>${escapeHtml(release.serial)}</small></a></li>`).join("")}</ul>`
          : ""
      }</li>`;
    })
    .join("");
  const crumbHtml: string = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${crumbs.map((crumb: Crumb): string => ` <span aria-hidden="true">&raquo;</span> ${crumb.href ? `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>` : `<span aria-current="page">${escapeHtml(crumb.label)}</span>`}`).join("")}</nav>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#0a0a0f">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/anton-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<div id="bg" aria-hidden="true"></div>
<div id="tint" aria-hidden="true"></div>
<a class="skip" href="#main">Skip to content</a>
<div class="page${isWide ? " wide" : ""}">
<header class="masthead">
  <a class="brand" href="/">${LOGO}</a>
  <form class="topsearch" action="/search/" role="search"><label class="sr" for="tq">Search codes</label><input id="tq" name="q" type="search" placeholder="Search codes" autocomplete="off"><button type="submit">Go</button></form>
</header>
<nav class="topnav" aria-label="Main"><a href="/">Home</a><a href="/games/">Games</a><a href="/downloads/">Downloads</a><a href="/how-to/">How to use</a><a href="/credits/">Credits</a><a href="/search/">Search</a></nav>
<nav class="platnav" aria-label="Games">${games.map((game: Game): string => `<a href="/games/${game.slug}/">${escapeHtml(game.short)}</a>`).join("")}</nav>
<div class="cols">
<aside class="side">
  <details class="box sidebox" open><summary><span>Games</span></summary><ul class="gamelist">${sideList}</ul></details>
  <div class="box sidebox sitebox"><h2><span>Site</span></h2><ul><li><a href="/how-to/">How to use</a></li><li><a href="/credits/">Credits</a></li><li><a href="/search/">Search</a></li></ul></div>
  <div class="badges">${buttonBadges()}</div>
</aside>
<main id="main">
${crumbHtml}
${body}
</main>
</div>
<footer class="foot">
  <div class="byline">
    <a class="ulabs" href="https://uppercut-labs.com" rel="noopener"><img src="/assets/uppercut-labs-logo.png" width="44" height="44" alt="" loading="lazy"><span><b>Uppercut Labs</b><small>uppercut-labs.com</small></span></a>
    <p class="by">Built and researched by <b>Devin Thomas</b></p>
    <ul class="social">
      <li><a href="https://github.com/devin-thomas" rel="noopener me" aria-label="Devin Thomas on GitHub">${iconSvg(siGithub)}<span>GitHub</span></a></li>
      <li><a href="https://x.com/gohan__fgc" rel="noopener me" aria-label="@gohan__fgc on X">${iconSvg(siX)}<span>@gohan__fgc</span></a></li>
    </ul>
  </div>
  <p>Unofficial fan site. Guilty Gear is a trademark of Arc System Works. No game assets are hosted here.</p>
  <p>Built ${escapeHtml(site.built)}. <button type="button" id="bgtoggle" class="linkbtn" aria-pressed="true">Background: on</button></p>
</footer>
</div>
<script type="module" src="/assets/site.js"></script>
</body>
</html>`;
}

function box(title: string, inner: string, id?: string): string {
  return `<section class="box"${id ? ` id="${id}"` : ""}><h2><span>${escapeHtml(title)}</span></h2><div class="boxin">${inner}</div></section>`;
}

function pageTitle(title: string, subtitle?: string): string {
  return `<h1 class="pt"><span>${escapeHtml(title)}</span></h1>${subtitle ? `<p class="sub">${subtitle}</p>` : ""}`;
}

function shortTitle(code: Code): string {
  return code.shortTitle ?? code.title;
}

function releaseCrumbs(release: Release, page: string): readonly Crumb[] {
  return [
    { label: "Games", href: "/games/" },
    { label: release.game.title, href: `/games/${release.game.slug}/`, game: release.game.id },
    { label: release.label, href: release.url },
    { label: page },
  ];
}

// ---------- tabs ----------
function releaseTabs(release: Release, activePath: string): string {
  let tabs: ReleaseTab[] = [
    ["", "Codes"],
    ["sheet/", "Raw sheet"],
    ["unlockables/", "Unlockables"],
    ["faq/", "FAQ"],
    ["tests/", "Test log"],
  ];
  if (release.hasLee4) tabs.push(["prior-art/", "lee4"]);
  return `<nav class="tabs" aria-label="${escapeHtml(release.game.title)} ${escapeHtml(release.label)}"><ul>${tabs
    .filter(([path]: ReleaseTab): boolean => !(path === "sheet/" && !release.codes.length))
    .map(
      ([path, label]: ReleaseTab): string =>
        `<li${activePath === path ? ' class="on"' : ""}><a href="${release.url}${path}"${activePath === path ? ' aria-current="page"' : ""}>${label}</a></li>`,
    )
    .join("")}</ul></nav>`;
}

function identityBox(release: Release): string {
  const summary: ReadonlyArray<readonly [string, string | number]> = [
    ["Region", escapeHtml(release.region)],
    ["Serial", escapeHtml(release.serial)],
    ["Version", escapeHtml(release.version)],
    ["PCSX2 CRC", `<code>${escapeHtml(release.crc)}</code>`],
    ["Feature pages", release.codes.length ? `${release.codes.length} ${verifiedGauge(release.counts, release.codes.length)}` : "none"],
    ["Downloadable patch sections", release.patchSections ?? 0],
  ];
  const strip: string = `<div class="tablewrap"><table class="grid identstrip"><thead><tr>${summary.map(([label]: readonly [string, string | number]): string => `<th>${label}</th>`).join("")}</tr></thead><tbody><tr>${summary.map(([label, value]: readonly [string, string | number]): string => `<td data-k="${label}">${value}</td>`).join("")}</tr></tbody></table></div>`;
  const hashRows: ReadonlyArray<LabelledValue | null> = [
    release.elf?.name
      ? ["ELF", `${escapeHtml(release.elf.name)}${release.elf.size ? `, ${release.elf.size.toLocaleString("en-US")} bytes` : ""}`]
      : null,
    release.elf?.sha256 ? ["ELF SHA-256", `<code class="hash">${escapeHtml(release.elf.sha256)}</code>`] : null,
    release.disc?.redump
      ? [
          "Disc",
          `<a class="ext" rel="noopener noreferrer" href="${escapeHtml(release.disc.redump)}">Redump</a>, CRC-32 <code>${escapeHtml(release.disc.crc32)}</code>, SHA-1 <code class="hash">${escapeHtml(release.disc.sha1)}</code>${release.disc.date ? `, EXE date ${escapeHtml(release.disc.date)}` : ""}`,
        ]
      : null,
    release.imageInfo ? ["Image", escapeHtml(release.imageInfo)] : null,
  ];
  const hashes: readonly LabelledValue[] = hashRows.filter((row: LabelledValue | null): row is LabelledValue => row !== null);
  return `<div class="ident">${strip}${
    hashes.length
      ? `<details><summary>Release hashes</summary><table class="kv">${hashes.map(([label, value]: LabelledValue): string => `<tr><th>${label}</th><td>${value}</td></tr>`).join("")}</table></details>`
      : ""
  }</div>`;
}

function releaseHeader(release: Release, activePath: string): string {
  return `${pageTitle(`${release.game.title}: ${release.label}`)}${identityBox(release)}${releaseTabs(release, activePath)}`;
}

// ---------- pages ----------
export function homePage(site: Site): string {
  let { games, shared }: Site = site;
  const totalCodes: number = site.releases.reduce((total: number, release: Release): number => total + release.codes.length, 0);
  const counts: Counts = totalCounts(site.releases);
  const gameRows: string = games
    .map((game: Game): string => {
      const codeCount: number = game.releases.reduce((total: number, release: Release): number => total + release.codes.length, 0);
      const gameCounts: Counts = totalCounts(game.releases);
      return `<tr><td><a href="/games/${game.slug}/">${escapeHtml(game.title)}</a></td><td>${game.releases.map((release: Release): string => `<a href="${release.url}">${escapeHtml(release.regionCode)}</a>`).join(" ")}</td><td class="num">${codeCount}</td><td>${verifiedGauge(gameCounts, codeCount)}</td></tr>`;
    })
    .join("");
  const unlockEverythingRows: string = site.releases
    .map((release: Release): { readonly release: Release; readonly code: Code | undefined } => ({
      release,
      code: release.codes.find((code: Code): boolean => /^Unlock everything/.test(code.title)),
    }))
    .filter((entry: { readonly release: Release; readonly code: Code | undefined }): entry is ReleaseUnlockCode => entry.code !== undefined)
    .map(
      ({ release, code }: ReleaseUnlockCode): string =>
        `<tr><td><a href="${code.url}">${escapeHtml(release.game.title)}</a></td><td>${escapeHtml(release.label)} <small>${escapeHtml(release.serial)}</small></td><td>${statusBadge(code.status)}</td></tr>`,
    )
    .join("");
  const body: string = `${pageTitle("Guilty Gear PS2 cheat codes")}
<div class="hero box"><div class="boxin"><p class="lead">${totalCodes} feature pages for ${site.releases.filter((release: Release): boolean => release.codes.length > 0).length} releases. ${counts.VERIFIED} verified in PCSX2. ${site.releases.reduce((total: number, release: Release): number => total + release.patchSections, 0)} downloadable patch sections.</p>
<form class="bigsearch" action="/search/" role="search"><label class="sr" for="hq">Search codes</label><input id="hq" name="q" type="search" placeholder="Search codes, e.g. Kliff, gold, stage" autocomplete="off"><button type="submit">Search</button></form></div></div>
${box("Games", `<div class="tablewrap"><table class="grid"><thead><tr><th>Game</th><th>Releases</th><th class="num">Features</th><th>Verified</th></tr></thead><tbody>${gameRows}</tbody></table></div>`)}
${box("Unlock everything", `<div class="tablewrap"><table class="grid"><thead><tr><th>Game</th><th>Release</th><th>Status</th></tr></thead><tbody>${unlockEverythingRows}</tbody></table></div>`)}
${box("Downloads", `<p><a href="/downloads/">Every .pnach file</a>, one per release, or <a href="/downloads/${ZIP}" download>all of them in one zip</a>.</p>`)}
${box("Status key", statusKey(shared))}`;
  return shell({
    title: "Guilty Codes: Guilty Gear PS2 cheat codes",
    description: "Unlock codes and PCSX2 cheat files for the Guilty Gear PS2 games, with test results.",
    site,
    body,
  });
}

function statusKey(shared: Shared): string {
  let keyMatch: RegExpMatchArray | null = shared.acDoc.match(/\*\*VERIFIED\*\*[\s\S]*?\*\*NOT TESTED\*\*\./);
  const keyText: string = keyMatch ? inlineMarkdownHtml(keyMatch[0].replace(/\n/g, " ")) : "";
  return `<p>${keyText} <b class="st st-superseded">SUPERSEDED</b> marks a code replaced by a corrected version. It stays listed.</p>`;
}

export function gamesIndex(site: Site): string {
  const body: string = `${pageTitle("Games")}${box(
    "All games",
    `<div class="tablewrap"><table class="grid"><thead><tr><th>Release</th><th>Region</th><th class="wide">Serial</th><th class="wide">CRC</th><th class="num">Features</th><th>Verified</th></tr></thead><tbody>${site.games
      .map(
        (game: Game): string =>
          `<tr class="grp"><td colspan="6"><a href="/games/${game.slug}/">${escapeHtml(game.title)}</a></td></tr>` +
          game.releases
            .map(
              (release: Release): string =>
                `<tr><td><a href="${release.url}">${escapeHtml(release.label)}</a></td><td>${escapeHtml(release.region)}</td><td>${escapeHtml(release.serial)}</td><td><code>${escapeHtml(release.crc)}</code></td><td class="num">${release.codes.length}</td><td>${verifiedGauge(release.counts, release.codes.length)}</td></tr>`,
            )
            .join(""),
      )
      .join("")}</tbody></table></div>`,
  )}`;
  return shell({
    title: "Games | Guilty Codes",
    description: "Guilty Gear PS2 games and releases with cheat codes.",
    site,
    body,
    crumbs: [{ label: "Games" }],
  });
}

export function gamePage(game: Game, site: Site): string {
  const rows: string = game.releases
    .map(
      (release: Release): string =>
        `<tr><td><a href="${release.url}">${escapeHtml(release.label)}</a></td><td>${escapeHtml(release.region)}</td><td>${escapeHtml(release.serial)}</td><td>${escapeHtml(release.version)}</td><td><code>${escapeHtml(release.crc)}</code></td><td class="num">${release.codes.length}</td><td>${verifiedGauge(release.counts, release.codes.length)}</td></tr>`,
    )
    .join("");
  const body: string = `${pageTitle(game.title)}${box(
    "Releases",
    `<div class="tablewrap"><table class="grid"><thead><tr><th>Release</th><th>Region</th><th>Serial</th><th>Version</th><th>CRC</th><th class="num">Features</th><th>Verified</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  )}`;
  return shell({
    title: `${game.title} cheats | Guilty Codes`,
    description: `Cheat codes for ${game.title}, by release.`,
    site,
    body,
    crumbs: [
      { label: "Games", href: "/games/" },
      { label: game.title, game: game.id },
    ],
  });
}

function codeTable(release: Release): string {
  const groups: readonly CodeGroup[] = GROUP_ORDER.filter((group: CodeGroup): boolean =>
    release.codes.some((code: Code): boolean => code.group === group),
  );
  const head: string = `<thead><tr><th>Feature</th><th class="hide-sm">Effect</th><th>Status</th><th class="hide-sm">Level</th></tr></thead>`;
  const rows: string = groups
    .map((group: CodeGroup): string => {
      let codes: readonly Code[] = release.codes.filter((code: Code): boolean => code.group === group);
      return (
        `<tr class="grp"><td colspan="4">${escapeHtml(group)} <small>${codes.length}</small></td></tr>` +
        codes
          .map(
            (code: Code): string =>
              `<tr class="code" data-s="${escapeHtml(code.status)}" data-t="${escapeHtml((code.title + " " + code.effect).toLowerCase())}"><td><a href="${code.url}">${escapeHtml(code.title)}</a></td><td class="hide-sm eff">${escapeHtml(shortEffect(code.effect))}</td><td>${statusBadge(code.status)}</td><td class="hide-sm">${levelMeter(code.level)}</td></tr>`,
          )
          .join("")
      );
    })
    .join("");
  return `<div class="tablewrap"><table class="grid codes" id="codetable">${head}<tbody>${rows}</tbody></table></div>`;
}

function shortEffect(effect: string): string {
  const cleaned: string = String(effect ?? "").replace(/\s*\(0x[0-9A-F]{6}[^)]*\)/g, "");
  return cleaned.length > 150 ? cleaned.slice(0, cleaned.lastIndexOf(" ", 147)) + "…" : cleaned;
}

function filterBar(release: Release): string {
  const presentStatuses: readonly Status[] = STATUS_ORDER.filter((status: Status): boolean => release.counts[status] > 0);
  return `<div class="filters" role="group" aria-label="Filter codes"><label class="sr" for="cf">Filter codes</label><input id="cf" type="search" placeholder="Filter this list" autocomplete="off">${presentStatuses
    .map(
      (status: Status): string =>
        `<button type="button" class="chip" data-status="${escapeHtml(status)}" aria-pressed="true">${statusBadge(status)} <b>${release.counts[status]}</b></button>`,
    )
    .join("")}<span id="shown" class="shown" aria-live="polite"></span></div>`;
}

export function releasePage(release: Release, site: Site): string {
  let intro: string = "";
  if (release.note && release.unlock.kind === "acplus" && release.unlock.isAppendEdition)
    intro = `<div class="warn"><b>Not run.</b> ${escapeHtml(release.note.replace(/^\*\*Append Edition: not run\.\*\*\s*/, ""))}</div>`;
  const download: string = release.pnachFile
    ? `<p class="dl"><a class="dlbtn" href="/pnach/${escapeHtml(release.pnachFile)}" download>Download ${escapeHtml(release.pnachFile)}</a></p>`
    : "";
  const body: string = `${releaseHeader(release, "")}${intro}${
    release.codes.length
      ? `${download}${filterBar(release)}${codeTable(release)}`
      : `<div class="box"><div class="boxin"><p>No codes for this release. See <a href="${release.url}unlockables/">Unlockables</a>.</p></div></div>`
  }`;
  return shell({
    title: `${release.game.title} ${release.label} (${release.serial}) cheats | Guilty Codes`,
    description: `${release.codes.length} feature pages for ${release.game.title}, ${release.region}, ${release.serial}, CRC ${release.crc}.`,
    site,
    body,
    crumbs: [
      { label: "Games", href: "/games/" },
      { label: release.game.title, href: `/games/${release.game.slug}/`, game: release.game.id },
      { label: `${release.label} ${release.serial}` },
    ],
  });
}

export function sheetPage(release: Release, site: Site): string {
  function hasRawCode(code: Code, group: CodeGroup): boolean {
    return code.group === group && code.raw.length > 0;
  }
  const groups: readonly CodeGroup[] = GROUP_ORDER.filter((group: CodeGroup): boolean =>
    release.codes.some((code: Code): boolean => hasRawCode(code, group)),
  );
  const sheetText: string = groups
    .map((group: CodeGroup): string => {
      let codes: readonly Code[] = release.codes.filter((code: Code): boolean => hasRawCode(code, group));
      return (
        `== ${group.toUpperCase()} ==\n\n` +
        codes
          .map(
            (code: Code): string =>
              `${code.title}  [${code.status}]\n${code.effect ? "  " + shortEffect(code.effect) + "\n" : ""}${code.raw.map((line: string): string => "  " + line).join("\n")}`,
          )
          .join("\n\n")
      );
    })
    .join("\n\n\n");
  const head: string = `${release.game.title}: ${release.label}\n${release.region}, ${release.serial}, CRC ${release.crc}\n${"-".repeat(60)}\n\n`;
  const hasOwnPages: boolean = release.codes.some((code: Code): boolean => code.kind === "compiled-module" || code.kind === "native-tip");
  const body: string = `${releaseHeader(release, "sheet/")}${hasOwnPages ? "<p>Compiled modules and native tips have their own feature pages. Use their instructions and complete downloads.</p>" : ""}<div class="boxcopy"><button class="copy" type="button" data-target="sheettext">Copy all</button><pre class="code sheet" id="sheettext" tabindex="0">${escapeHtml(head + sheetText)}\n</pre></div>`;
  return shell({
    title: `${release.game.title} ${release.label} raw code sheet | Guilty Codes`,
    description: `${release.codes.filter((code: Code): boolean => code.raw.length > 0).length} raw codes for ${release.game.title} ${release.serial} on one page.`,
    site,
    body,
    crumbs: releaseCrumbs(release, "Raw sheet"),
  });
}

// ----- code page -----
function priorArtFor(code: Code, site: PageSite): string {
  const priorArt: string | undefined = site.priorMap.get(code.title);
  return priorArt && code.release.hasLee4
    ? `<p>Prior art: lee4, 2014 (<a href="${code.release.url}prior-art/">lee4 codes</a>). ${inlineMarkdownHtml(priorArt.replace(/\n/g, " "))}</p>`
    : "";
}

const LIFECYCLE_KEYS: ReadonlyArray<keyof Lifecycle> = ["enable", "disable", "reset", "persistence"];

function featureDetails(code: Code): string {
  if (!code.kind) return "";
  function referenceLinks(ids: readonly string[]): string {
    return ids.length
      ? ids
          .map((id: string): string => {
            let target: Code = requireValue(
              code.release.codes.find((candidate: Code): boolean => candidate.id === id),
              "feature reference",
            );
            return `<a href="${escapeHtml(target.url)}">${escapeHtml(target.title)}</a>`;
          })
          .join(", ")
      : "None";
  }
  const rows: readonly LabelledValue[] = [
    ["Kind", code.kind.replace(/-/g, " ")],
    ["Controls", code.controls.join("; ")],
    ...LIFECYCLE_KEYS.map(
      (key: keyof Lifecycle): LabelledValue => [
        key.charAt(0).toUpperCase() + key.slice(1),
        code.kind === "compiled-module" && key === "enable" ? patchSetupText(code.lifecycle[key]) : code.lifecycle[key],
      ],
    ),
  ];
  const provenance: string = `https://github.com/devin-thomas/retro-graphics-research/blob/${code.source.revision}/${code.source.path.split("/").map(encodeURIComponent).join("/")}`;
  return (
    box(
      "Use and recovery",
      `<table class="kv">${rows.map(([key, value]: LabelledValue): string => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}<tr><th>Requires</th><td>${referenceLinks(code.dependencies)}</td></tr><tr><th>Conflicts with</th><td>${referenceLinks(code.conflicts)}</td></tr></table>${code.compatibilityNotes.length ? `<ul>${code.compatibilityNotes.map((note: string): string => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}`,
    ) +
    box(
      "Source",
      `<p><a class="ext" rel="noopener noreferrer" href="${provenance}">Pinned evidence</a>, revision <code>${escapeHtml(code.source.revision)}</code>.</p><p>Evidence SHA-256: <code class="hash">${escapeHtml(code.source.sha256)}</code></p>`,
    )
  );
}

type CodePresentation = { readonly heading: "Instructions" | "Compiled module" | "Raw code"; readonly html: string };

function codePresentation(code: Code): CodePresentation {
  switch (code.kind) {
    case "native-tip":
      return {
        heading: "Instructions",
        html: `<ol>${code.instructions.map((instruction: string): string => `<li>${escapeHtml(instruction)}</li>`).join("")}</ol>`,
      };
    case "compiled-module":
      return {
        heading: "Compiled module",
        html: `<p>Install the complete module using the download below. It contains ${code.artifact.sectionCount} patch sections.</p>`,
      };
    case "simple-code":
    case undefined:
      return {
        heading: "Raw code",
        html: `<div class="boxcopy"><button class="copy" type="button" data-target="raw">Copy</button><pre class="code" id="raw" tabindex="0">${escapeHtml(code.raw.join("\n"))}</pre></div>${code.inputNote ? `<p>${escapeHtml(code.inputNote)}</p>` : ""}`,
      };
    default:
      return assertNever(code);
  }
}

function sentence(text: string): string {
  const capitalized: string = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?)]$/.test(capitalized) ? capitalized : capitalized + ".";
}

export function codePage(code: Code, site: PageSite, neighbors: Neighbors): string {
  let release: Release = code.release;
  const isSuperseded: boolean = code.status === "SUPERSEDED";
  const warning: string = isSuperseded
    ? `<div class="warn danger"><b>Superseded.</b> Every save address is 8 bytes below the 2014 version. The 2009 set's Gold and Shadow code sets SE and VOICE volume to 1, and the change stays after you save. Use <a href="${release.url}${code.counterpartId}/">the 2014 code</a>.</div>`
    : "";
  const replaces: string =
    !isSuperseded && code.counterpartId ? `<p>Replaces <a href="${release.url}${code.counterpartId}/">the 2009 version</a>.</p>` : "";
  const rows: readonly LabelledValue[] = [
    ["Game", `<a href="/games/${release.game.slug}/">${escapeHtml(release.game.title)}</a>`],
    [
      "Release",
      `<a href="${release.url}">${escapeHtml(release.label)}</a> ${escapeHtml(release.serial)}, CRC <code>${escapeHtml(release.crc)}</code>`,
    ],
    ["Group", escapeHtml(code.group)],
    [
      "Status",
      `${statusBadge(code.status)}${code.statusNote && code.statusNote.toUpperCase() !== code.status ? ` <small>${escapeHtml(code.statusNote.replace(/\s*\(S\d\)\s*/, " "))}</small>` : ""}`,
    ],
    ["Evidence", levelMeter(code.level)],
    ["Real hardware", statusBadge(code.hardware)],
  ];
  const presentation: CodePresentation = codePresentation(code);
  const instructions: string =
    code.kind && code.kind !== "native-tip" && code.instructions.length
      ? box(
          "Setup instructions",
          `<ol>${code.instructions.map((instruction: string): string => `<li>${escapeHtml(code.kind === "compiled-module" ? patchSetupText(instruction) : instruction)}</li>`).join("")}</ol>`,
        )
      : "";
  const pnachBlock: string = code.artifact
    ? `<p><a class="dlbtn" href="/pnach/${escapeHtml(code.artifact.file)}" download="${escapeHtml(release.serial)}_${escapeHtml(release.crc)}.pnach">Download ${escapeHtml(code.artifact.file)}</a></p><p>${code.artifact.sectionCount} patch sections. SHA-256: <code class="hash">${escapeHtml(code.artifact.sha256)}</code></p>`
    : code.pnach
      ? `<div class="boxcopy"><button class="copy" type="button" data-target="pn">Copy</button><pre class="code" id="pn" tabindex="0">${escapeHtml(code.pnach)}</pre></div>${release.pnachFile ? `<p><a href="/pnach/${escapeHtml(release.pnachFile)}" download>${escapeHtml(release.pnachFile)}</a>, all sections</p>` : ""}`
      : `<p>Not a memory write.</p>`;
  const published: Published | undefined = code.published;
  const credit: string = published
    ? `<p>Posted by <b>${escapeHtml(published.author)}</b>, ${escapeHtml(published.date)}. ${[published.url ? `<a class="ext" rel="noopener noreferrer" href="${escapeHtml(published.url)}">${/gamefaqs/.test(published.url) ? "GameFAQs thread" : "GameHacking.org forum"}</a>` : "", published.archive ? `<a class="ext" rel="noopener noreferrer" href="${escapeHtml(published.archive)}">Wayback capture</a>` : "", published.mirror ? `<a class="ext" rel="noopener noreferrer" href="${escapeHtml(published.mirror)}">GameHacking.org</a>` : ""].filter(Boolean).join(" &middot; ")}</p>${replaces}`
    : `<p>Author: ${escapeHtml(code.author || "Devin Thomas")}.</p>${priorArtFor(code, site)}${code.credit ? `<p>Source: ${inlineMarkdownHtml(code.credit)}</p>` : ""}`;
  const checked: string = code.checked ? `<p>${escapeHtml(sentence(code.checked))}</p>` : `<p>No individual test run.</p>`;
  const pageNav: string = `<nav class="pn"><span>${neighbors.previous ? `<a href="${neighbors.previous.url}" rel="prev">&laquo; ${escapeHtml(shortTitle(neighbors.previous))}</a>` : ""}</span><span>${neighbors.next ? `<a href="${neighbors.next.url}" rel="next">${escapeHtml(shortTitle(neighbors.next))} &raquo;</a>` : ""}</span></nav>`;
  const body: string = `${pageTitle(code.title)}${warning}<table class="kv meta">${rows.map(([label, value]: LabelledValue): string => `<tr><th>${label}</th><td>${value}</td></tr>`).join("")}</table>
${box(presentation.heading, presentation.html)}${code.kind === "native-tip" ? "" : box("PCSX2", pnachBlock + (code.artifact ? patchInstallHtml(release) : ""))}${instructions}${box("Effect", `<p>${escapeHtml(code.effect)}</p>`)}${box("Test result", checked)}${featureDetails(code)}${box("Credit", credit)}${pageNav}`;
  return shell({
    title: `${code.title} | ${release.game.title} ${release.label} | Guilty Codes`,
    description: `${code.title}: ${shortEffect(code.effect)} ${release.serial}, CRC ${release.crc}.`,
    site,
    body,
    crumbs: releaseCrumbs(release, shortTitle(code)),
  });
}

// ----- unlockables / faq / tests -----
function prose(html: string): string {
  return `<div class="prose">${html}</div>`;
}

function tableHtml(table: Table): string {
  return markdownHtml(tableMarkdown(table.header, table.rows), { shift: 0 });
}

function unlockHtml(release: Release, site: Site): string {
  let shared: Shared = site.shared;
  let unlock: Unlock = release.unlock;
  let parts: string[] = [];
  switch (unlock.kind) {
    case "acplus": {
      parts.push(
        box(
          "Play time",
          prose(
            `${tableHtml(shared.playTime)}${markdownHtml(shared.stageSelectPlayTime.replace(/\(0x[0-9A-F]+\)\s*/g, ""), { shift: 0 })}`,
          ),
        ),
      );
      parts.push(
        box(
          "Characters, EX, gold and black",
          prose(markdownHtml(shared.charactersMd.replace(/^Character ids/m, "Character ids"), { shift: 2 })),
        ),
      );
      parts.push(box("Stage table", prose(tableHtml(shared.stageTable))));
      parts.push(box("How each stage is unlocked", prose(tableHtml(shared.stageFlags))));
      if (unlock.isJapanese)
        parts.unshift(`<div class="warn">Save offsets keep the same layout as the US disc; only the base address moved.</div>`);
      break;
    }
    case "x2": {
      const criticalHits: readonly string[] = requireValue(
        parseTables(sectionBody(shared.x2Doc, "## Prior work and sources"))
          .flatMap((table: Table): ReadonlyArray<readonly string[]> => table.rows)
          .find((row: readonly string[]): boolean => /Critical Hits/.test(requireValue(row[0], "source title"))),
        "Critical Hits source",
      );
      parts.push(
        box(
          "Native rules",
          prose(
            markdownHtml(
              `${requireValue(criticalHits[0], "source title").replace(/\s*\(Portuguese\)$/, "")} (Portuguese): ${criticalHits[1]}.`,
              {
                shift: 0,
              },
            ),
          ),
        ),
      );
      parts.push(
        box("Play time", prose(markdownHtml(textBetween(shared.x2Doc, /\*\*Play-time unlocks\*\*/, /\n## Verification/), { shift: 2 }))),
      );
      break;
    }
    case "family": {
      parts.push(
        box("Where the unlocks live", prose(markdownHtml(requireValue(shared.familyMaps[unlock.mapKey], "family mapping"), { shift: 0 }))),
      );
      break;
    }
    case "x": {
      parts.push(box("Title-screen code", prose(markdownHtml(unlock.markdown, { shift: 2 }))));
      break;
    }
    case "xplus": {
      parts.push(
        box(
          "Passwords",
          `<div class="tablewrap"><table class="grid"><thead><tr><th>Password</th><th>Effect</th><th>Status</th></tr></thead><tbody>${release.codes.map((code: Code): string => `<tr><td><a href="${code.url}"><code>${escapeHtml(code.raw[0])}</code></a></td><td>${escapeHtml(code.effect)}</td><td>${statusBadge(code.status)}</td></tr>`).join("")}</tbody></table></div>`,
        ),
      );
      parts.push(
        box(
          "Petit 2 link passwords",
          prose(
            tableHtml(unlock.directionTable) +
              markdownHtml(
                textBetween(
                  unlock.markdown,
                  /\*\*The Petit 2 link passwords run the other way\.\*\*/,
                  /\n\| Password \| Direction/,
                ).replace(/^\*\*[^*]+\*\*\s*/, ""),
                { shift: 0 },
              ),
          ),
        ),
      );
      parts.push(box("Unlock levels", prose(markdownHtml(unlock.levelNote, { shift: 2 }))));
      break;
    }
    case "isuka": {
      parts.push(box("Status", prose(markdownHtml(unlock.markdown, { shift: 2 }))));
      break;
    }
    case "taikenban": {
      parts.push(box("Status", prose(markdownHtml(unlock.markdown, { shift: 2 }))));
      break;
    }
    default:
      assertNever(unlock);
  }
  return parts.join("");
}

export function unlockPage(release: Release, site: Site): string {
  const body: string = `${releaseHeader(release, "unlockables/")}${unlockHtml(release, site)}`;
  return shell({
    title: `${release.game.title} ${release.label} unlockables | Guilty Codes`,
    description: `How ${release.game.title} (${release.serial}) unlocks characters, colours and stages in normal play.`,
    site,
    body,
    crumbs: releaseCrumbs(release, "Unlockables"),
  });
}

export function faqPage(release: Release, site: Site): string {
  let shared: Shared = site.shared;
  let unlock: Unlock = release.unlock;
  let parts: string[] = [];
  if (unlock.kind === "acplus") {
    parts.push(box("Quick start", prose(tableHtml(shared.quickStart))));
    parts.push(box("Caveats", prose(markdownHtml(shared.caveatsMd, { shift: 2 }))));
  } else if (unlock.kind === "x2") {
    parts.push(box("Caveats", prose(markdownHtml(sectionBody(shared.x2Doc, "## Caveats"), { shift: 2 }))));
  } else {
    parts.push(
      box(
        "Caveats",
        prose(
          `<ul><li>These codes are for ${escapeHtml(release.serial)} (CRC ${escapeHtml(release.crc)}) only. Nothing is carried over from another release without a test.</li><li>Save-data codes are permanent once the game saves. Back up your memory card first.</li></ul>`,
        ),
      ),
    );
  }
  parts.push(`<p>Setup steps for PCSX2 and cheat devices: <a href="/how-to/">How to use</a>.</p>`);
  const body: string = `${releaseHeader(release, "faq/")}${parts.join("")}`;
  return shell({
    title: `${release.game.title} ${release.label} FAQ | Guilty Codes`,
    description: `Questions about using the ${release.game.title} (${release.serial}) codes.`,
    site,
    body,
    crumbs: releaseCrumbs(release, "FAQ"),
  });
}

export function testsPage(release: Release, site: Site): string {
  let shared: Shared = site.shared;
  let unlock: Unlock = release.unlock;
  let parts: string[] = [];
  if (unlock.kind === "acplus" && !unlock.isJapanese) {
    parts.push(
      box(
        "Test setup",
        `<table class="kv">${shared.testSetup.map(([label, value]: readonly [string, string]): string => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>`,
      ),
    );
    parts.push(box("Results", prose(tableHtml(shared.verification))));
    parts.push(box("Stage table states", prose(tableHtml(shared.stageStates) + markdownHtml(shared.forcedEntries, { shift: 2 }))));
    parts.push(box("Guide claims checked", prose(markdownHtml(shared.guideClaims, { shift: 2 }))));
  } else if (unlock.kind === "acplus") {
    parts.push(
      box(
        "Results",
        prose(
          tableHtml(shared.jpRuntime) +
            `<p>${escapeHtml(shared.jpSingleCharacter)}</p>${unlock.isAppendEdition ? `<p>${escapeHtml(shared.jpAppendEdition)}</p>` : ""}`,
        ),
      ),
    );
  } else if (unlock.kind === "x2") {
    parts.push(box("Results", prose(markdownHtml(verificationTableMarkdown(shared.x2Doc), { shift: 0 }))));
  } else if (unlock.kind === "family") {
    const familyName: string = requireValue(release.familyName, "family name");
    const rows: ReadonlyArray<readonly string[]> = shared.familyRows.filter(
      (row: readonly string[]): boolean =>
        stripMarkdown(row[0]).includes(familyName) ||
        (/#Reload \(Japan\), GGXX/.test(stripMarkdown(row[0])) && /Japan|GGXX/.test(familyName)),
    );
    parts.push(
      box(
        "Results",
        prose(
          markdownHtml(
            tableMarkdown(
              ["Code", "Status", "Seen"],
              rows.map((row: readonly string[]): readonly string[] => [
                requireValue(row[1], "code"),
                requireValue(row[2], "status"),
                requireValue(row[3], "result"),
              ]),
            ),
            { shift: 0 },
          ),
        ),
      ),
    );
  } else if (unlock.kind === "x") {
    parts.push(box("Results", prose(markdownHtml(unlock.markdown, { shift: 2 }))));
  } else {
    parts.push(box("Results", `<p>Nothing tested for this release.</p>`));
  }
  const body: string = `${releaseHeader(release, "tests/")}${parts.join("")}`;
  return shell({
    title: `${release.game.title} ${release.label} test log | Guilty Codes`,
    description: `What was tested for ${release.game.title} (${release.serial}) and what was seen.`,
    site,
    body,
    crumbs: releaseCrumbs(release, "Test log"),
  });
}

function verificationTableMarkdown(x2Doc: string): string {
  return sectionBody(x2Doc, "## Verification")
    .split("\n")
    .filter((line: string): boolean => /^\|/.test(line))
    .join("\n");
}

// ----- lee4 prior art page -----
export function lee4Page(release: Release, site: Site): string {
  let shared: Shared = site.shared;
  let publishedCodes: readonly PublishedCode[] = release.codes.filter((code: Code): code is PublishedCode => code.published !== undefined);
  function yearTable(year: string): string {
    return `<div class="tablewrap"><table class="grid"><thead><tr><th>Code</th><th>Status</th></tr></thead><tbody>${publishedCodes
      .filter((code: PublishedCode): boolean => code.published.year === year)
      .map(
        (code: PublishedCode): string =>
          `<tr><td><a href="${code.url}">${escapeHtml(code.shortTitle)}</a></td><td>${statusBadge(code.status)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  }
  const body: string = `${releaseHeader(release, "prior-art/")}
${box("Credit", prose(markdownHtml(shared.priorWork.replace(/^\*\*Prior work\.\*\* /, ""), { shift: 0 })), "credit")}
<div class="warn danger"><b>2009 set: superseded.</b> ${inlineMarkdownHtml(shared.verdict.replace(/\n/g, " "))}</div>
<p>Cheat-device master code, the same in both versions: <code>${escapeHtml(shared.masterCode)}</code></p>
<div class="two">${box("2014 (current)", yearTable("2014"))}${box("2009 (superseded)", yearTable("2009"))}</div>
${box("Where each version writes", prose(tableHtml(shared.lee4Writes)))}
${box("SE and VOICE volume", prose(markdownHtml(shared.sideEffect.replace(/^\*\*[^*]+\*\*\s*/, ""), { shift: 2 })))}
${box("Both versions tested", prose(tableHtml(shared.lee4Tests)))}`;
  return shell({
    title: `lee4 codes: 2014 and 2009 | ${release.game.title} | Guilty Codes`,
    description: "lee4's 2014 unlock codes and the superseded 2009 version for Accent Core Plus (SLUS-21847).",
    site,
    body,
    crumbs: releaseCrumbs(release, "lee4"),
  });
}

// ----- downloads -----
export const ZIP: "guiltycodes-pnach.zip" = "guiltycodes-pnach.zip";

export function downloadsPage(site: Site, files: readonly Download[]): string {
  const rows: string = files
    .map(
      (download: Download): string =>
        `<tr><td><a href="${download.feature?.url ?? download.release.url}">${escapeHtml(download.feature?.title ?? download.release.game.title)}</a></td><td>${escapeHtml(download.release.label)}</td><td class="wide">${escapeHtml(download.release.serial)}</td><td class="wide">${escapeHtml(download.release.crc)}</td><td class="num">${download.sectionCount}</td><td><a href="/pnach/${escapeHtml(download.file)}" download>${escapeHtml(download.file)}</a></td></tr>`,
    )
    .join("");
  const body: string = `${pageTitle("Downloads", patchInstallSummary())}
${
  files.length
    ? `<p class="dl"><a class="dlbtn" href="/downloads/${ZIP}" download>Download all (${files.length} files, zip)</a></p>
${box("Files", `<div class="tablewrap"><table class="grid"><thead><tr><th>Game or feature</th><th>Release</th><th class="wide">Serial</th><th class="wide">CRC</th><th class="num">Patch sections</th><th>File</th></tr></thead><tbody>${rows}</tbody></table></div>`)}`
    : box("Files", "<p>No cheat files in this build.</p>")
}
${box("GitHub", `<p>Each version is also a <a class="ext" rel="noopener noreferrer" href="https://github.com/devin-thomas/guiltycodes/releases/latest">GitHub release</a> with the same files.</p>`)}`;
  return shell({
    title: "Downloads | Guilty Codes",
    description: `${files.length} PCSX2 .pnach cheat files for the Guilty Gear PS2 games.`,
    site,
    body,
    crumbs: [{ label: "Downloads" }],
  });
}

// ----- how to / credits / search / 404 -----
export function howToPage(site: Site): string {
  const howTo: string = site.shared.howTo;
  const pcsx2Steps: string = sectionBody(howTo, "### PCSX2 (1.7 / 2.x)");
  const hardwareSteps: string = sectionBody(howTo, "### Real hardware (cheat devices)");
  const body: string = `${pageTitle("How to use")}${box("Selectable feature downloads (PCSX2 2.x)", patchInstallHtml({ serial: "SLUS-21847", crc: "F233A433" }) + '<p>Patches and cheats share the PNACH format; the folder selects which properties page lists them. See <a class="ext" rel="noopener noreferrer" href="https://pcsx2.net/docs/advanced/writing-patches/">PCSX2 patch documentation</a>.</p>')}${box("Legacy release cheat files", prose(markdownHtml(pcsx2Steps.replace(/F233A433\.pnach/g, "&lt;CRC&gt;.pnach").replace(/`SLUS-21847_&lt;CRC&gt;\.pnach`/g, "`SERIAL_CRC.pnach`"), { shift: 2 })))}${box("Real hardware", prose(markdownHtml(hardwareSteps, { shift: 2 })))}`;
  return shell({
    title: "How to use | Guilty Codes",
    description: "Using the codes in PCSX2 and on cheat devices.",
    site,
    body,
    crumbs: [{ label: "How to use" }],
  });
}

export function creditsPage(site: Site): string {
  let shared: Shared = site.shared;
  const levels: string = Object.entries(shared.evidenceLevels)
    .map(([level, meaning]: [string, string]): string => `<tr><td><b>${escapeHtml(level)}</b></td><td>${escapeHtml(meaning)}</td></tr>`)
    .join("");
  const x2PriorWork: string = sectionBody(shared.x2Doc, "## Prior work and sources")
    .split("\n")
    .filter((line: string): boolean => /^\||^As far/.test(line) && !/^As far/.test(line))
    .join("\n");
  const body: string = `${pageTitle("Credits")}
${box("Accent Core Plus (SLUS-21847)", prose(markdownHtml(shared.priorWork, { shift: 0 }) + tableHtml(shared.sourcesTable)), "lee4")}
${box("GameHacking.org", prose(`<p><a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103882">Game 103882</a> (Accent Core Plus), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103881">103881</a> (Accent Core: Fullcodes' play-time code and lee4's gallery code), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103880">103880</a> (X2), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103879">103879</a> (X), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103877">103877</a> (Isuka).</p>`), "gamehacking")}
${box("Dustloop", prose(`<p>Gold and Shadow behaviour is documented in <a class="ext" rel="noopener noreferrer" href="https://www.forums.dustloop.com/topic/10501-differences-between-regular-and-ex-goldshadow-and-sp-characters-in-the-guilty-gear-xx-series/">Dustloop's thread on EX, Gold/Shadow and SP characters</a>: Shadow characters have infinite Tension, and gold characters are a boss mode with per-character buffs.</p>`), "dustloop")}
${box("X2 sources", prose(markdownHtml(x2PriorWork, { shift: 0 })))}
${box("Other sources", prose(`<ul><li><a class="ext" rel="noopener noreferrer" href="https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663">skuldnoshinpu, Guilty Gear X Plus Additions FAQ</a>: the X Plus passwords.</li><li><a class="ext" rel="noopener noreferrer" href="https://gamefaqs.gamespot.com/boards/944396-guilty-gear-xx-accent-core-plus/53678667">GameFAQs, Unlockables stages</a>: the Kliff and Justice stage claim, checked on the <a href="/games/guilty-gear-xx-accent-core-plus/us-slus-21847/tests/">test log</a>.</li><li><a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/%CE%9B_Core_Plus">guiltygear.wiki.gg, &Lambda; Core Plus</a>: stage unlocks through Story Mode.</li><li><a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/Guilty_Gear_Petit_2">Guilty Gear Petit 2</a> and <a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/Guilty_Gear_X_Plus">X Plus</a> on guiltygear.wiki.gg: the Petit 2 link passwords.</li><li><a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/Isuka">Isuka</a> on guiltygear.wiki.gg: Isuka's native unlock rules.</li></ul>`))}
${box("Evidence levels", `<div class="tablewrap"><table class="grid"><thead><tr><th>Level</th><th>Meaning</th></tr></thead><tbody>${levels}</tbody></table></div>`, "evidence-levels")}
${box("Site", prose(`<p>Background: <a class="ext" rel="noopener noreferrer" href="https://www.npmjs.com/package/@uppercut-labs/dreamcast-backgrounds">@uppercut-labs/dreamcast-backgrounds</a>. Headings: Anton (OFL). The logo, frames and badges are CSS and SVG drawn for this site.</p>`))}`;
  return shell({
    title: "Credits | Guilty Codes",
    description: "Prior art and sources behind the codes.",
    site,
    body,
    crumbs: [{ label: "Credits" }],
  });
}

export function searchPage(site: Site): string {
  const body: string = `${pageTitle("Search")}<form class="bigsearch" id="sform" role="search"><label class="sr" for="sq">Search codes</label><input id="sq" name="q" type="search" placeholder="Search codes" autocomplete="off" autofocus><button type="submit">Search</button></form><p id="sres" class="shown" aria-live="polite"></p><div class="tablewrap"><table class="grid" id="stable" hidden><thead><tr><th>Code</th><th>Game</th><th>Status</th></tr></thead><tbody></tbody></table></div><noscript><p>Search needs JavaScript. Browse the <a href="/games/">games</a> instead.</p></noscript>`;
  return shell({ title: "Search | Guilty Codes", description: "Search every code.", site, body, crumbs: [{ label: "Search" }] });
}

export function notFoundPage(site: Site): string {
  const body: string = `${pageTitle("Page not found")}<p>Try the <a href="/games/">games list</a> or <a href="/search/">search</a>.</p>`;
  return shell({ title: "Page not found | Guilty Codes", description: "Page not found.", site, body });
}
