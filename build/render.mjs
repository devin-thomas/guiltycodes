// HTML templates. Everything visible is either generated from the source docs or a short label.
import { esc, md, mdInline, tableToMd, stripMd, slugify, section, between, cleanMd, parseTables } from "./lib.mjs";
import { STATUS_ORDER } from "./data.mjs";
import { siGithub, siX } from "simple-icons";

const cls = (s) => s.toLowerCase().replace(/\s+/g, "-");
export const badge = (s) => `<span class="st st-${cls(s)}">${esc(s)}</span>`;

export function level(l) {
  if (!l) return `<span class="lv lv-none" title="No evidence level recorded">&ndash;</span>`;
  const n = Number(l[1]);
  return `<span class="lv" title="${esc(l)}"><span class="segs" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i${i <= n ? ' class="on"' : ""}></i>`).join("")}</span><b>${esc(l)}</b></span>`;
}

export function gauge(counts, total) {
  const v = counts.VERIFIED ?? 0;
  if (!total) return `<span class="gauge empty" aria-label="No codes"><span class="gtxt">no codes</span></span>`;
  const pct = Math.round((v / total) * 100);
  return `<span class="gauge" role="img" aria-label="${v} of ${total} verified"><span class="gfill" style="width:${pct}%"></span><span class="gtxt">${v}/${total}</span></span>`;
}

const GROUP_ORDER = ["Everything", "Characters and modes", "EX characters", "Gold, black and SP colours", "Progress", "Stages", "Passwords", "lee4, 2014", "lee4, 2009 (superseded)"];

// ---------- 88x31 button badges ----------
function button(top, bottom, a, b, href, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="31" viewBox="0 0 88 31" role="img" aria-label="${esc(label)}"><defs><linearGradient id="b${esc(slugify(top + bottom))}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect x=".5" y=".5" width="87" height="30" fill="url(#b${esc(slugify(top + bottom))})" stroke="#000"/><rect x="1.5" y="1.5" width="85" height="28" fill="none" stroke="rgba(255,255,255,.35)"/><text x="44" y="13" text-anchor="middle" font-family="Verdana,Tahoma,sans-serif" font-size="9" font-weight="bold" fill="#fff" stroke="#000" stroke-width=".6" paint-order="stroke">${esc(top)}</text><text x="44" y="25" text-anchor="middle" font-family="Verdana,Tahoma,sans-serif" font-size="8" fill="#fff" stroke="#000" stroke-width=".5" paint-order="stroke">${esc(bottom)}</text></svg>`;
  return `<a class="btn88" href="${href}"${/^https?:/.test(href) ? ' rel="noopener noreferrer"' : ""} title="${esc(label)}">${svg}</a>`;
}
const badges = () =>
  [
    button("PCSX2", ".pnach", "#3a7bd5", "#12294f", "/how-to/", "How to use the PCSX2 files"),
    button("lee4", "2014 + 2009", "#d42a3a", "#5a0a12", "/credits/#lee4", "lee4 credit"),
    button("GameHacking", ".org", "#2a9d6a", "#0d3b28", "/credits/#gamehacking", "GameHacking.org credit"),
    button("Dustloop", "credit", "#b5481d", "#4b1a08", "/credits/#dustloop", "Dustloop credit"),
    button("S0 - S6", "evidence", "#c79b27", "#4d3a0b", "/credits/#evidence-levels", "Evidence levels"),
  ].join("");

const icon = (i) => `<svg class="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${i.path}"/></svg>`;

// ---------- page shell ----------
const LOGO = `<svg class="logo" viewBox="0 0 400 66" role="img" aria-label="Guilty Codes"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".48" stop-color="#ffd9d9"/><stop offset=".5" stop-color="#ff2b3d"/><stop offset="1" stop-color="#6a0610"/></linearGradient></defs><g transform="skewX(-12) translate(18 0)"><text x="0" y="52" font-family="Anton,Impact,'Arial Narrow',sans-serif" font-size="56" letter-spacing="2" fill="url(#lg)" stroke="#000" stroke-width="7" paint-order="stroke" stroke-linejoin="round">GUILTY CODES</text></g><path d="M6 61 L392 14" stroke="#e6b43c" stroke-width="2.5" opacity=".9"/><path d="M6 64 L392 17" stroke="#000" stroke-width="1" opacity=".7"/></svg>`;

export function shell({ title, desc, path, site, crumbs = [], body, wide = false }) {
  const games = site.games;
  const cur = crumbs.find((c) => c.game)?.game;
  const side = games
    .map((g) => {
      const open = cur === g.id;
      return `<li${open ? ' class="open"' : ""}><a href="/games/${g.slug}/">${esc(g.title)}</a>${
        open ? `<ul>${g.releases.map((r) => `<li><a href="${r.url}">${esc(r.label)} <small>${esc(r.serial)}</small></a></li>`).join("")}</ul>` : ""
      }</li>`;
    })
    .join("");
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${crumbs.map((c) => ` <span aria-hidden="true">&raquo;</span> ${c.href ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span aria-current="page">${esc(c.label)}</span>`}`).join("")}</nav>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0a0a0f">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/anton-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<div id="bg" aria-hidden="true"></div>
<div id="tint" aria-hidden="true"></div>
<a class="skip" href="#main">Skip to content</a>
<div class="page${wide ? " wide" : ""}">
<header class="masthead">
  <a class="brand" href="/">${LOGO}</a>
  <form class="topsearch" action="/search/" role="search"><label class="sr" for="tq">Search codes</label><input id="tq" name="q" type="search" placeholder="Search codes" autocomplete="off"><button type="submit">Go</button></form>
</header>
<nav class="topnav" aria-label="Main"><a href="/">Home</a><a href="/games/">Games</a><a href="/how-to/">How to use</a><a href="/credits/">Credits</a><a href="/search/">Search</a></nav>
<nav class="platnav" aria-label="Games">${games.map((g) => `<a href="/games/${g.slug}/">${esc(g.short)}</a>`).join("")}</nav>
<div class="cols">
<aside class="side">
  <details class="box sidebox" open><summary><span>Games</span></summary><ul class="gamelist">${side}</ul></details>
  <div class="box sidebox sitebox"><h2><span>Site</span></h2><ul><li><a href="/how-to/">How to use</a></li><li><a href="/credits/">Credits</a></li><li><a href="/search/">Search</a></li></ul></div>
  <div class="badges">${badges()}</div>
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
      <li><a href="https://github.com/devin-thomas" rel="noopener me" aria-label="Devin Thomas on GitHub">${icon(siGithub)}<span>GitHub</span></a></li>
      <li><a href="https://x.com/gohan__fgc" rel="noopener me" aria-label="@gohan__fgc on X">${icon(siX)}<span>@gohan__fgc</span></a></li>
    </ul>
  </div>
  <p>Unofficial fan site. Guilty Gear is a trademark of Arc System Works. No game assets are hosted here.</p>
  <p>Built ${esc(site.built)}. <button type="button" id="bgtoggle" class="linkbtn" aria-pressed="true">Background: on</button></p>
</footer>
</div>
<script src="/assets/site.js" defer></script>
</body>
</html>`;
}

const box = (title, inner, id) => `<section class="box"${id ? ` id="${id}"` : ""}><h2><span>${esc(title)}</span></h2><div class="boxin">${inner}</div></section>`;
const pageTitle = (t, sub) => `<h1 class="pt"><span>${esc(t)}</span></h1>${sub ? `<p class="sub">${sub}</p>` : ""}`;

const shortTitle = (c) => c.shortTitle ?? c.title;

// ---------- tabs ----------
function tabs(r, active) {
  const t = [
    ["", "Codes"],
    ["sheet/", "Raw sheet"],
    ["unlockables/", "Unlockables"],
    ["faq/", "FAQ"],
    ["tests/", "Test log"],
  ];
  if (r.hasLee4) t.push(["prior-art/", "lee4"]);
  return `<nav class="tabs" aria-label="${esc(r.game.title)} ${esc(r.label)}"><ul>${t
    .filter(([p]) => !(p === "sheet/" && !r.codes.length))
    .map(([p, l]) => `<li${active === p ? ' class="on"' : ""}><a href="${r.url}${p}"${active === p ? ' aria-current="page"' : ""}>${l}</a></li>`)
    .join("")}</ul></nav>`;
}

function identBox(r) {
  const rows = [
    ["Region", esc(r.region)],
    ["Serial", esc(r.serial)],
    ["Version", esc(r.version)],
    ["PCSX2 CRC", `<code>${esc(r.crc)}</code>`],
    ["Codes", r.codes.length ? `${r.codes.length} ${gauge(r.counts, r.codes.length)}` : "none"],
  ];
  const strip = `<div class="tablewrap"><table class="grid identstrip"><thead><tr>${rows.map(([k]) => `<th>${k}</th>`).join("")}</tr></thead><tbody><tr>${rows.map(([k, v]) => `<td data-k="${k}">${v}</td>`).join("")}</tr></tbody></table></div>`;
  const hashes = [
    r.elf?.name ? ["ELF", `${esc(r.elf.name)}${r.elf.size ? `, ${r.elf.size.toLocaleString("en-US")} bytes` : ""}`] : null,
    r.elf?.sha256 ? ["ELF SHA-256", `<code class="hash">${esc(r.elf.sha256)}</code>`] : null,
    r.disc?.redump ? ["Disc", `<a class="ext" rel="noopener noreferrer" href="${esc(r.disc.redump)}">Redump</a>, CRC-32 <code>${esc(r.disc.crc32)}</code>, SHA-1 <code class="hash">${esc(r.disc.sha1)}</code>${r.disc.date ? `, EXE date ${esc(r.disc.date)}` : ""}`] : null,
    r.imageInfo ? ["Image", esc(r.imageInfo)] : null,
  ].filter(Boolean);
  return `<div class="ident">${strip}${
    hashes.length ? `<details><summary>Release hashes</summary><table class="kv">${hashes.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table></details>` : ""
  }</div>`;
}

function relHeader(r, active) {
  return `${pageTitle(`${r.game.title}: ${r.label}`)}${identBox(r)}${tabs(r, active)}`;
}

// ---------- pages ----------
export function homePage(site) {
  const { games, shared } = site;
  const totalCodes = site.releases.reduce((n, r) => n + r.codes.length, 0);
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, site.releases.reduce((n, r) => n + r.counts[s], 0)]));
  const rows = games
    .map((g) => {
      const n = g.releases.reduce((a, r) => a + r.codes.length, 0);
      const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, g.releases.reduce((a, r) => a + r.counts[s], 0)]));
      return `<tr><td><a href="/games/${g.slug}/">${esc(g.title)}</a></td><td>${g.releases.map((r) => `<a href="${r.url}">${esc(r.regionShort)}</a>`).join(" ")}</td><td class="num">${n}</td><td>${gauge(c, n)}</td></tr>`;
    })
    .join("");
  const ue = site.releases
    .map((r) => ({ r, c: r.codes.find((c) => /^Unlock everything/.test(c.title)) }))
    .filter((x) => x.c)
    .map(({ r, c }) => `<tr><td><a href="${c.url}">${esc(r.game.title)}</a></td><td>${esc(r.label)} <small>${esc(r.serial)}</small></td><td>${badge(c.status)}</td></tr>`)
    .join("");
  const body = `${pageTitle("Guilty Gear PS2 cheat codes")}
<div class="hero box"><div class="boxin"><p class="lead">${totalCodes} codes for ${site.releases.filter((r) => r.codes.length).length} releases. ${counts.VERIFIED} verified in PCSX2.</p>
<form class="bigsearch" action="/search/" role="search"><label class="sr" for="hq">Search codes</label><input id="hq" name="q" type="search" placeholder="Search codes, e.g. Kliff, gold, stage" autocomplete="off"><button type="submit">Search</button></form></div></div>
${box("Games", `<div class="tablewrap"><table class="grid"><thead><tr><th>Game</th><th>Releases</th><th class="num">Codes</th><th>Verified</th></tr></thead><tbody>${rows}</tbody></table></div>`)}
${box("Unlock everything", `<div class="tablewrap"><table class="grid"><thead><tr><th>Game</th><th>Release</th><th>Status</th></tr></thead><tbody>${ue}</tbody></table></div>`)}
${box("Status key", statusKey(shared))}`;
  return shell({ title: "Guilty Codes: Guilty Gear PS2 cheat codes", desc: "Unlock codes and PCSX2 cheat files for the Guilty Gear PS2 games, with test results.", path: "/", site, body });
}

function statusKey(shared) {
  const m = shared.acDoc.match(/\*\*VERIFIED\*\*[\s\S]*?\*\*NOT TESTED\*\*\./);
  const base = m ? mdInline(m[0].replace(/\n/g, " ")) : "";
  return `<p>${base} <b class="st st-superseded">SUPERSEDED</b> marks a code replaced by a corrected version. It stays listed.</p>`;
}

export function gamesIndex(site) {
  const body = `${pageTitle("Games")}${box(
    "All games",
    `<div class="tablewrap"><table class="grid"><thead><tr><th>Release</th><th>Region</th><th>Serial</th><th>CRC</th><th class="num">Codes</th><th>Verified</th></tr></thead><tbody>${site.games
      .map(
        (g) =>
          `<tr class="grp"><td colspan="6"><a href="/games/${g.slug}/">${esc(g.title)}</a></td></tr>` +
          g.releases
            .map((r) => `<tr><td><a href="${r.url}">${esc(r.label)}</a></td><td>${esc(r.region)}</td><td>${esc(r.serial)}</td><td><code>${esc(r.crc)}</code></td><td class="num">${r.codes.length}</td><td>${gauge(r.counts, r.codes.length)}</td></tr>`)
            .join(""),
      )
      .join("")}</tbody></table></div>`,
  )}`;
  return shell({ title: "Games | Guilty Codes", desc: "Guilty Gear PS2 games and releases with cheat codes.", site, body, crumbs: [{ label: "Games" }] });
}

export function gamePage(g, site) {
  const rows = g.releases
    .map(
      (r) =>
        `<tr><td><a href="${r.url}">${esc(r.label)}</a></td><td>${esc(r.region)}</td><td>${esc(r.serial)}</td><td>${esc(r.version)}</td><td><code>${esc(r.crc)}</code></td><td class="num">${r.codes.length}</td><td>${gauge(r.counts, r.codes.length)}</td></tr>`,
    )
    .join("");
  const body = `${pageTitle(g.title)}${box(
    "Releases",
    `<div class="tablewrap"><table class="grid"><thead><tr><th>Release</th><th>Region</th><th>Serial</th><th>Version</th><th>CRC</th><th class="num">Codes</th><th>Verified</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  )}`;
  return shell({ title: `${g.title} cheats | Guilty Codes`, desc: `Cheat codes for ${g.title}, by release.`, site, body, crumbs: [{ label: "Games", href: "/games/" }, { label: g.title, game: g.id }] });
}

function codeTable(r) {
  const groups = GROUP_ORDER.filter((gname) => r.codes.some((c) => c.group === gname));
  const head = `<thead><tr><th>Code</th><th class="hide-sm">Effect</th><th>Status</th><th class="hide-sm">Level</th></tr></thead>`;
  const rows = groups
    .map((gname) => {
      const cs = r.codes.filter((c) => c.group === gname);
      return (
        `<tr class="grp"><td colspan="4">${esc(gname)} <small>${cs.length}</small></td></tr>` +
        cs
          .map(
            (c) =>
              `<tr class="code" data-s="${esc(c.status)}" data-t="${esc((c.title + " " + c.effect).toLowerCase())}"><td><a href="${c.url}">${esc(c.title)}</a></td><td class="hide-sm eff">${esc(shortEffect(c.effect))}</td><td>${badge(c.status)}</td><td class="hide-sm">${level(c.level)}</td></tr>`,
          )
          .join("")
      );
    })
    .join("");
  return `<div class="tablewrap"><table class="grid codes" id="codetable">${head}<tbody>${rows}</tbody></table></div>`;
}
const shortEffect = (e) => {
  const s = String(e ?? "").replace(/\s*\(0x[0-9A-F]{6}[^)]*\)/g, "");
  return s.length > 150 ? s.slice(0, s.lastIndexOf(" ", 147)) + "…" : s;
};

function filterBar(r) {
  const present = STATUS_ORDER.filter((s) => r.counts[s]);
  return `<div class="filters" role="group" aria-label="Filter codes"><label class="sr" for="cf">Filter codes</label><input id="cf" type="search" placeholder="Filter this list" autocomplete="off">${present
    .map((s) => `<button type="button" class="chip" data-status="${esc(s)}" aria-pressed="true">${badge(s)} <b>${r.counts[s]}</b></button>`)
    .join("")}<span id="shown" class="shown" aria-live="polite"></span></div>`;
}

export function releasePage(r, site) {
  let intro = "";
  if (r.note && r.unlock.append) intro = `<div class="warn"><b>Not run.</b> ${esc(r.note.replace(/^\*\*Append Edition: not run\.\*\*\s*/, ""))}</div>`;
  const dl = r.pnachFile ? `<p class="dl"><a class="dlbtn" href="/pnach/${esc(r.pnachFile)}" download>Download ${esc(r.pnachFile)}</a></p>` : "";
  const body = `${relHeader(r, "")}${intro}${
    r.codes.length
      ? `${dl}${filterBar(r)}${codeTable(r)}`
      : `<div class="box"><div class="boxin"><p>No codes for this release. See <a href="${r.url}unlockables/">Unlockables</a>.</p></div></div>`
  }`;
  return shell({
    title: `${r.game.title} ${r.label} (${r.serial}) cheats | Guilty Codes`,
    desc: `${r.codes.length} codes for ${r.game.title}, ${r.region}, ${r.serial}, CRC ${r.crc}.`,
    site,
    body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: `${r.label} ${r.serial}` }],
  });
}

export function sheetPage(r, site) {
  const groups = GROUP_ORDER.filter((gname) => r.codes.some((c) => c.group === gname));
  const text = groups
    .map((gname) => {
      const cs = r.codes.filter((c) => c.group === gname);
      return `== ${gname.toUpperCase()} ==\n\n` + cs.map((c) => `${c.title}  [${c.status}]\n${c.effect ? "  " + shortEffect(c.effect) + "\n" : ""}${c.raw.map((l) => "  " + l).join("\n")}`).join("\n\n");
    })
    .join("\n\n\n");
  const head = `${r.game.title}: ${r.label}\n${r.region}, ${r.serial}, CRC ${r.crc}\n${"-".repeat(60)}\n\n`;
  const body = `${relHeader(r, "sheet/")}<div class="boxcopy"><button class="copy" type="button" data-target="sheettext">Copy all</button><pre class="code sheet" id="sheettext" tabindex="0">${esc(head + text)}\n</pre></div>`;
  return shell({ title: `${r.game.title} ${r.label} raw code sheet | Guilty Codes`, desc: `All ${r.codes.length} raw codes for ${r.game.title} ${r.serial} on one page.`, site, body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: r.label, href: r.url }, { label: "Raw sheet" }] });
}

// ----- code page -----
function priorArtFor(c, site) {
  const m = site.priorMap.get(c.title);
  return m && c.release.hasLee4 ? `<p>Prior art: lee4, 2014 (<a href="${c.release.url}prior-art/">lee4 codes</a>). ${mdInline(m.replace(/\n/g, " "))}</p>` : "";
}

export function codePage(c, site, idx) {
  const r = c.release;
  const superseded = c.status === "SUPERSEDED";
  const warn = superseded
    ? `<div class="warn danger"><b>Superseded.</b> Every save address is 8 bytes below the 2014 version. The 2009 set's Gold and Shadow code sets SE and VOICE volume to 1, and the change stays after you save. Use <a href="${r.url}${c.mateId}/">the 2014 code</a>.</div>`
    : "";
  const mate = !superseded && c.mateId ? `<p>Replaces <a href="${r.url}${c.mateId}/">the 2009 version</a>.</p>` : "";
  const rows = [
    ["Game", `<a href="/games/${r.game.slug}/">${esc(r.game.title)}</a>`],
    ["Release", `<a href="${r.url}">${esc(r.label)}</a> ${esc(r.serial)}, CRC <code>${esc(r.crc)}</code>`],
    ["Group", esc(c.group)],
    ["Status", `${badge(c.status)}${c.statusNote && c.statusNote.toUpperCase() !== c.status ? ` <small>${esc(c.statusNote.replace(/\s*\(S\d\)\s*/, " "))}</small>` : ""}`],
    ["Evidence", level(c.level)],
    ["Real hardware", badge(c.hardware)],
  ];
  const rawBlock = `<div class="boxcopy"><button class="copy" type="button" data-target="raw">Copy</button><pre class="code" id="raw" tabindex="0">${esc(c.raw.join("\n"))}</pre></div>${c.inputNote ? `<p>${esc(c.inputNote)}</p>` : ""}`;
  const pnachBlock = c.pnach
    ? `<div class="boxcopy"><button class="copy" type="button" data-target="pn">Copy</button><pre class="code" id="pn" tabindex="0">${esc(c.pnach)}</pre></div>${r.pnachFile ? `<p><a href="/pnach/${esc(r.pnachFile)}" download>${esc(r.pnachFile)}</a>, all sections</p>` : ""}`
    : `<p>Not a memory write.</p>`;
  const pub = c.published;
  const credit = pub
    ? `<p>Posted by <b>${esc(pub.author)}</b>, ${esc(pub.date)}. ${[pub.url ? `<a class="ext" rel="noopener noreferrer" href="${esc(pub.url)}">${/gamefaqs/.test(pub.url) ? "GameFAQs thread" : "GameHacking.org forum"}</a>` : "", pub.archive ? `<a class="ext" rel="noopener noreferrer" href="${esc(pub.archive)}">Wayback capture</a>` : "", pub.mirror ? `<a class="ext" rel="noopener noreferrer" href="${esc(pub.mirror)}">GameHacking.org</a>` : ""].filter(Boolean).join(" &middot; ")}</p>${mate}`
    : `<p>Author: ${esc(c.author || "Devin Thomas")}.</p>${priorArtFor(c, site)}${c.credit ? `<p>Source: ${mdInline(c.credit)}</p>` : ""}`;
  const sentence = (t) => { const s = t.charAt(0).toUpperCase() + t.slice(1); return /[.!?)]$/.test(s) ? s : s + "."; };
  const checked = c.checked ? `<p>${esc(sentence(c.checked))}</p>` : `<p>No individual test run.</p>`;
  const nav = `<nav class="pn"><span>${idx.prev ? `<a href="${idx.prev.url}" rel="prev">&laquo; ${esc(shortTitle(idx.prev))}</a>` : ""}</span><span>${idx.next ? `<a href="${idx.next.url}" rel="next">${esc(shortTitle(idx.next))} &raquo;</a>` : ""}</span></nav>`;
  const body = `${pageTitle(c.title)}${warn}<table class="kv meta">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
${box("Raw code", rawBlock)}${box("PCSX2", pnachBlock)}${box("Effect", `<p>${esc(c.effect)}</p>`)}${box("Test result", checked)}${box("Credit", credit)}${nav}`;
  return shell({
    title: `${c.title} | ${r.game.title} ${r.label} | Guilty Codes`,
    desc: `${c.title}: ${shortEffect(c.effect)} ${r.serial}, CRC ${r.crc}.`,
    site,
    body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: r.label, href: r.url }, { label: shortTitle(c) }],
  });
}

// ----- unlockables / faq / tests -----
const prose = (html) => `<div class="prose">${html}</div>`;

export function unlockHtml(r, site) {
  const s = site.shared;
  const u = r.unlock;
  const parts = [];
  if (u.kind === "acplus") {
    parts.push(box("Play time", prose(`${md(tableToMd(s.playTime.header, s.playTime.rows), { shift: 0 })}${md(s.timeSep.replace(/\(0x[0-9A-F]+\)\s*/g, ""), { shift: 0 })}`)));
    parts.push(box("Characters, EX, gold and black", prose(md(s.charactersMd.replace(/^Character ids/m, "Character ids"), { shift: 2 }))));
    parts.push(box("Stage table", prose(md(tableToMd(s.stageTable.header, s.stageTable.rows), { shift: 0 }))));
    parts.push(box("How each stage is unlocked", prose(md(tableToMd(s.stageFlags.header, s.stageFlags.rows), { shift: 0 }))));
    if (u.jp) parts.unshift(`<div class="warn">Save offsets keep the same layout as the US disc; only the base address moved.</div>`);
  } else if (u.kind === "x2") {
    const ch = parseTables(section(s.x2Doc, "## Prior work and sources")).flatMap((t) => t.rows).find((row) => /Critical Hits/.test(row[0]));
    parts.push(box("Native rules", prose(md(`${ch[0].replace(/\s*\(Portuguese\)$/, "")} (Portuguese): ${ch[1]}.`, { shift: 0 }))));
    parts.push(box("Play time", prose(md(between(s.x2Doc, /\*\*Play-time unlocks\*\*/, /\n## Verification/), { shift: 2 }))));
  } else if (u.kind === "family") {
    parts.push(box("Where the unlocks live", prose(md(s.famMaps[u.mapKey], { shift: 0 }))));
  } else if (u.kind === "x") {
    parts.push(box("Title-screen code", prose(md(u.md, { shift: 2 }))));
  } else if (u.kind === "xplus") {
    parts.push(box("Passwords", `<div class="tablewrap"><table class="grid"><thead><tr><th>Password</th><th>Effect</th><th>Status</th></tr></thead><tbody>${r.codes.map((c) => `<tr><td><a href="${c.url}"><code>${esc(c.raw[0])}</code></a></td><td>${esc(c.effect)}</td><td>${badge(c.status)}</td></tr>`).join("")}</tbody></table></div>`));
    parts.push(box("Petit 2 link passwords", prose(md(tableToMd(u.dirTable.header, u.dirTable.rows), { shift: 0 }) + md(between(u.md, /\*\*The Petit 2 link passwords run the other way\.\*\*/, /\n\| Password \| Direction/).replace(/^\*\*[^*]+\*\*\s*/, ""), { shift: 0 }))));
    parts.push(box("Unlock levels", prose(md(u.levelNote, { shift: 2 }))));
  } else if (u.kind === "isuka") {
    parts.push(box("Status", prose(md(u.md, { shift: 2 }))));
  } else if (u.kind === "taikenban") {
    parts.push(box("Status", prose(md(u.md, { shift: 2 }))));
  }
  return parts.join("");
}
function tableWith2(x2Doc) {
  const sec = section(x2Doc, "## Prior work and sources");
  const t = sec.split("\n").filter((l) => /^\|/.test(l));
  return t.join("\n");
}

export function unlockPage(r, site) {
  const body = `${relHeader(r, "unlockables/")}${unlockHtml(r, site)}`;
  return shell({ title: `${r.game.title} ${r.label} unlockables | Guilty Codes`, desc: `How ${r.game.title} (${r.serial}) unlocks characters, colours and stages in normal play.`, site, body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: r.label, href: r.url }, { label: "Unlockables" }] });
}

export function faqPage(r, site) {
  const s = site.shared;
  const u = r.unlock;
  const parts = [];
  if (u.kind === "acplus") {
    parts.push(box("Quick start", prose(md(tableToMd(s.quickStart.header, s.quickStart.rows), { shift: 0 }))));
    parts.push(box("Caveats", prose(md(s.caveatsMd, { shift: 2 }))));
  } else if (u.kind === "x2") {
    parts.push(box("Caveats", prose(md(section(s.x2Doc, "## Caveats"), { shift: 2 }))));
  } else {
    parts.push(box("Caveats", prose(`<ul><li>These codes are for ${esc(r.serial)} (CRC ${esc(r.crc)}) only. Nothing is carried over from another release without a test.</li><li>Save-data codes are permanent once the game saves. Back up your memory card first.</li></ul>`)));
  }
  parts.push(`<p>Setup steps for PCSX2 and cheat devices: <a href="/how-to/">How to use</a>.</p>`);
  const body = `${relHeader(r, "faq/")}${parts.join("")}`;
  return shell({ title: `${r.game.title} ${r.label} FAQ | Guilty Codes`, desc: `Questions about using the ${r.game.title} (${r.serial}) codes.`, site, body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: r.label, href: r.url }, { label: "FAQ" }] });
}

export function testsPage(r, site) {
  const s = site.shared;
  const u = r.unlock;
  const parts = [];
  if (u.kind === "acplus" && !u.jp) {
    parts.push(box("Test setup", `<table class="kv">${s.testSetup.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`));
    parts.push(box("Results", prose(md(tableToMd(s.verification.header, s.verification.rows), { shift: 0 }))));
    parts.push(box("Stage table states", prose(md(tableToMd(s.stageStates.header, s.stageStates.rows), { shift: 0 }) + md(s.accept, { shift: 2 }))));
    parts.push(box("Guide claims checked", prose(md(s.guideClaims, { shift: 2 }))));
  } else if (u.kind === "acplus") {
    parts.push(box("Results", prose(md(tableToMd(s.jpRuntime.header, s.jpRuntime.rows), { shift: 0 }) + `<p>${esc(s.jpSingle)}</p>${u.append ? `<p>${esc(s.jpAppend)}</p>` : ""}`)));
  } else if (u.kind === "x2") {
    parts.push(box("Results", prose(md(tableWith2b(s.x2Doc), { shift: 0 }))));
  } else if (u.kind === "family") {
    const rows = s.famRows.filter((row) => stripMd(row[0]).includes(r.famName) || (/#Reload \(Japan\), GGXX/.test(stripMd(row[0])) && /Japan|GGXX/.test(r.famName)));
    parts.push(box("Results", prose(md(tableToMd(["Code", "Status", "Seen"], rows.map((x) => [x[1], x[2], x[3]])), { shift: 0 }))));
  } else if (u.kind === "x") {
    parts.push(box("Results", prose(md(u.md, { shift: 2 }))));
  } else {
    parts.push(box("Results", `<p>Nothing tested for this release.</p>`));
  }
  const body = `${relHeader(r, "tests/")}${parts.join("")}`;
  return shell({ title: `${r.game.title} ${r.label} test log | Guilty Codes`, desc: `What was tested for ${r.game.title} (${r.serial}) and what was seen.`, site, body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: r.label, href: r.url }, { label: "Test log" }] });
}
function tableWith2b(x2Doc) {
  const sec = section(x2Doc, "## Verification");
  return sec.split("\n").filter((l) => /^\|/.test(l)).join("\n");
}

// ----- lee4 prior art page -----
export function lee4Page(r, site) {
  const s = site.shared;
  const cs = r.codes.filter((c) => c.published);
  const mk = (yr) =>
    `<div class="tablewrap"><table class="grid"><thead><tr><th>Code</th><th>Status</th></tr></thead><tbody>${cs
      .filter((c) => c.published.year === yr)
      .map((c) => `<tr><td><a href="${c.url}">${esc(c.shortTitle)}</a></td><td>${badge(c.status)}</td></tr>`)
      .join("")}</tbody></table></div>`;
  const body = `${relHeader(r, "prior-art/")}
${box("Credit", prose(md(s.priorWork.replace(/^\*\*Prior work\.\*\* /, ""), { shift: 0 })), "credit")}
<div class="warn danger"><b>2009 set: superseded.</b> ${mdInline(s.verdict.replace(/\n/g, " "))}</div>
<p>Cheat-device master code, the same in both versions: <code>${esc(s.masterCode)}</code></p>
<div class="two">${box("2014 (current)", mk("2014"))}${box("2009 (superseded)", mk("2009"))}</div>
${box("Where each version writes", prose(md(tableToMd(s.lee4Where.header, s.lee4Where.rows), { shift: 0 })))}
${box("SE and VOICE volume", prose(md(s.sideEffect.replace(/^\*\*[^*]+\*\*\s*/, ""), { shift: 2 })))}
${box("Both versions tested", prose(md(tableToMd(s.lee4Tests.header, s.lee4Tests.rows), { shift: 0 })))}`;
  return shell({ title: `lee4 codes: 2014 and 2009 | ${r.game.title} | Guilty Codes`, desc: "lee4's 2014 unlock codes and the superseded 2009 version for Accent Core Plus (SLUS-21847).", site, body,
    crumbs: [{ label: "Games", href: "/games/" }, { label: r.game.title, href: `/games/${r.game.slug}/`, game: r.game.id }, { label: r.label, href: r.url }, { label: "lee4" }] });
}

// ----- how to / credits / search / 404 -----
export function howToPage(site) {
  const s = site.shared;
  const h = s.howTo;
  const pc = section(h, "### PCSX2 (1.7 / 2.x)");
  const hw = section(h, "### Real hardware (cheat devices)");
  const body = `${pageTitle("How to use")}${box("PCSX2", prose(md(pc.replace(/F233A433\.pnach/g, "&lt;CRC&gt;.pnach").replace(/`SLUS-21847_&lt;CRC&gt;\.pnach`/g, "`SERIAL_CRC.pnach`"), { shift: 2 })))}${box("Real hardware", prose(md(hw, { shift: 2 })))}`;
  return shell({ title: "How to use | Guilty Codes", desc: "Using the codes in PCSX2 and on cheat devices.", site, body, crumbs: [{ label: "How to use" }] });
}

export function creditsPage(site) {
  const s = site.shared;
  const levels = Object.entries(s.evidenceLevels).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join("");
  const x2prior = section(s.x2Doc, "## Prior work and sources").split("\n").filter((l) => /^\||^As far/.test(l) && !/^As far/.test(l)).join("\n");
  const body = `${pageTitle("Credits")}
${box("Accent Core Plus (SLUS-21847)", prose(md(s.priorWork, { shift: 0 }) + md(tableToMd(s.sourcesTable.header, s.sourcesTable.rows), { shift: 0 })), "lee4")}
${box("GameHacking.org", prose(`<p><a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103882">Game 103882</a> (Accent Core Plus), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103881">103881</a> (Accent Core: Fullcodes' play-time code and lee4's gallery code), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103880">103880</a> (X2), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103879">103879</a> (X), <a class="ext" rel="noopener noreferrer" href="https://gamehacking.org/game/103877">103877</a> (Isuka).</p>`), "gamehacking")}
${box("Dustloop", prose(`<p>Gold and Shadow behaviour is documented in <a class="ext" rel="noopener noreferrer" href="https://www.forums.dustloop.com/topic/10501-differences-between-regular-and-ex-goldshadow-and-sp-characters-in-the-guilty-gear-xx-series/">Dustloop's thread on EX, Gold/Shadow and SP characters</a>: Shadow characters have infinite Tension, and gold characters are a boss mode with per-character buffs.</p>`), "dustloop")}
${box("X2 sources", prose(md(x2prior, { shift: 0 })))}
${box("Other sources", prose(`<ul><li><a class="ext" rel="noopener noreferrer" href="https://gamefaqs.gamespot.com/ps2/536497-guilty-gear-x-plus/faqs/18663">skuldnoshinpu, Guilty Gear X Plus Additions FAQ</a>: the X Plus passwords.</li><li><a class="ext" rel="noopener noreferrer" href="https://gamefaqs.gamespot.com/boards/944396-guilty-gear-xx-accent-core-plus/53678667">GameFAQs, Unlockables stages</a>: the Kliff and Justice stage claim, checked on the <a href="/games/guilty-gear-xx-accent-core-plus/us-slus-21847/tests/">test log</a>.</li><li><a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/%CE%9B_Core_Plus">guiltygear.wiki.gg, &Lambda; Core Plus</a>: stage unlocks through Story Mode.</li><li><a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/Guilty_Gear_Petit_2">Guilty Gear Petit 2</a> and <a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/Guilty_Gear_X_Plus">X Plus</a> on guiltygear.wiki.gg: the Petit 2 link passwords.</li><li><a class="ext" rel="noopener noreferrer" href="https://guiltygear.wiki.gg/wiki/Isuka">Isuka</a> on guiltygear.wiki.gg: Isuka's native unlock rules.</li></ul>`))}
${box("Evidence levels", `<div class="tablewrap"><table class="grid"><thead><tr><th>Level</th><th>Meaning</th></tr></thead><tbody>${levels}</tbody></table></div>`, "evidence-levels")}
${box("Site", prose(`<p>Background: <a class="ext" rel="noopener noreferrer" href="https://www.npmjs.com/package/@uppercut-labs/dreamcast-backgrounds">@uppercut-labs/dreamcast-backgrounds</a>. Headings: Anton (OFL). The logo, frames and badges are CSS and SVG drawn for this site.</p>`))}`;
  return shell({ title: "Credits | Guilty Codes", desc: "Prior art and sources behind the codes.", site, body, crumbs: [{ label: "Credits" }] });
}

export function searchPage(site) {
  const body = `${pageTitle("Search")}<form class="bigsearch" id="sform" role="search"><label class="sr" for="sq">Search codes</label><input id="sq" name="q" type="search" placeholder="Search codes" autocomplete="off" autofocus><button type="submit">Search</button></form><p id="sres" class="shown" aria-live="polite"></p><div class="tablewrap"><table class="grid" id="stable" hidden><thead><tr><th>Code</th><th>Game</th><th>Status</th></tr></thead><tbody></tbody></table></div><noscript><p>Search needs JavaScript. Browse the <a href="/games/">games</a> instead.</p></noscript>`;
  return shell({ title: "Search | Guilty Codes", desc: "Search every code.", site, body, crumbs: [{ label: "Search" }] });
}

export function notFoundPage(site) {
  const body = `${pageTitle("Page not found")}<p>Try the <a href="/games/">games list</a> or <a href="/search/">search</a>.</p>`;
  return shell({ title: "Page not found | Guilty Codes", desc: "Page not found.", site, body });
}
