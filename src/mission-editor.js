// Mission Editor page: builds the form from window.MISSION_DATA (src/mission-data.js) and writes the .pnach text.
// Loaded only on the Mission Editor page, after site.js. Edits are kept in localStorage, per browser.
(() => {
  const D = window.MISSION_DATA;
  const root = document.getElementById("med");
  if (!D || !root) return;
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const KEY = "gc-mission-edits";
  const LAST = 25; // slots 26-30 unlock after 1-25 are cleared

  // ---- evidence: the schema's proof level of each field and side, shown as the site's badges ----
  // emulator -> VERIFIED; panel, code and emulator-ram -> INFERRED; unknown -> NOT TESTED
  const ST = { v: ["VERIFIED", "st-verified"], i: ["INFERRED", "st-inferred"], n: ["NOT TESTED", "st-not-tested"] };
  const LVL = { emulator: "v", "emulator-ram": "i", panel: "i", code: "i", unknown: "n" };
  const LVLTXT = {
    emulator: "Emulator-proven: changed by cheat and the effect seen in a fight.",
    "emulator-ram": "Reached the game's data in a running fight; the effect itself was not seen.",
    panel: "Matches the game's own info screen on every visible stock mission; the in-fight effect is the game's own rule.",
    code: "Read from the game's code, not run.",
    unknown: "The same in all 30 stock missions; its meaning is not known. Leave it alone.",
  };
  const badge = (lvl, title) => `<span class="st ${ST[LVL[lvl] || "n"][1]}" title="${esc(title || LVLTXT[lvl] || "")}">${ST[LVL[lvl] || "n"][0]}</span>`;
  // status cell for a field: one badge when both sides agree, otherwise one per side
  function status(k) {
    const p = D.PROOF[k];
    if (typeof p === "string") return badge(p);
    if (!p) return badge("unknown");
    if (p.player === p.enemy) return badge(p.player);
    return `<span class="sides2"><span>You ${badge(p.player)}</span><span>Opp. ${badge(p.enemy)}</span></span>`;
  }

  // ---- field layout: one entry per field, grouped. t: num | sel | chk. why: plain words; ev: what was seen. ----
  const CLEAR = ["Judge", "Beat the enemy", "Survive to time-up"];
  const SIDE_GROUPS = [
    ["Fighter", [
      { k: "char", label: "Character", t: "sel", opts: "char", why: "The fighter. On your side 0 means whoever you pick; forcing a fighter on your side is not tested.", ev: "Opponent seen in the fight: Ky, Potemkin, Order-Sol and others." },
      { k: "sp", label: "Colour", t: "sel", opts: [[0, "Normal"], [1, "Gold"], [2, "Black"]], why: "Normal, Gold or Black version. The panel prints only the opponent's.", ev: "Gold Potemkin seen in the fight; Black and EX Black on the panel." },
      { k: "ex", label: "EX version", t: "chk", why: "The EX version of the character. The panel prints only the opponent's.", ev: "EX Ky and EX Order-Sol seen on the panel and in the fight." },
      { k: "colour", label: "Palette", t: "num", why: "Colour slot, used when Colour is Normal. 0 to 31." },
    ]],
    ["Life", [
      { k: "life", label: "Start life", t: "num", why: "Start life, 1 to 420 (420 is a full bar; 460 needs the life-460 cheat).", ev: "Your 210 and 105, the opponent's 30, and 460 with life-460 were seen in fights." },
      { k: "regain", label: "Regain", t: "num", why: "Recoverable life (the :REGAIN tag). 1 is on." },
      { k: "heal", label: "Heal", t: "num", why: "Life regeneration (:HEAL). 1 is on.", ev: "Your Heal reached the game's data in Ghost Survival." },
      { k: "poison", label: "Poison", t: "num", why: "Life drains over time (:POISON), and the fighter turns pink. 1 is on.", ev: "Your Poison seen in Poison Sprint: pink, life falling without hits." },
    ]],
    ["Tension, guard and burst", [
      { k: "tension_mode", label: "Tension", t: "sel", opts: [[0, "Normal"], [1, "None"], [2, "Hold"]], why: "How Tension behaves: normal, no gain, or held at the start value.", ev: "Hold keeps the bar full: Poison Sprint (you), Ghost Survival (opponent)." },
      { k: "tension", label: "Start Tension", t: "num", step: 100, why: "Tension at the start. 10000 is full." },
      { k: "guard", label: "Guard level", t: "num", why: "Start Guard Level, -128 to 128. A negative one is weaker.", ev: "Prints as given on the panel, negatives included." },
      { k: "burst", label: "Psych Burst", t: "sel", opts: [[0, "None"], [1, "OK"], [2, "Infinite"]], why: "Psych Burst: none, available, or unlimited.", ev: "Infinite seen on both gauges in Glass Cannon." },
    ]],
    ["Damage rules", [
      { k: "no_normal", label: "No normal damage", t: "chk", why: "This fighter's normal moves deal no damage." },
      { k: "no_special", label: "No special damage", t: "chk", why: "This fighter's special moves deal no damage." },
      { k: "no_overdrive", label: "No Overdrive damage", t: "chk", why: "This fighter's Overdrives deal no damage.", ev: "All three off on EX Ky in Glass Cannon: Sol kept his life." },
      { k: "dead_angle", label: "Dead Angle damages", t: "chk", why: "This fighter's Dead Angle Attacks deal damage." },
      { k: "combo_over", label: "Combo: only after hit N", t: "num", why: "Only hits after the Nth hit of a combo deal damage. 0 is off. If both combo fields are set, the panel prints only this one." },
      { k: "combo_under", label: "Combo: first N hits only", t: "num", why: "Only the first N hits of a combo deal damage. 0 is off." },
      { k: "position", label: "Hits count", t: "sel", opts: [[0, "Anywhere"], [1, "To ground"], [2, "To air"]], why: "This fighter only damages a grounded or an airborne target." },
    ]],
    ["Seals", [
      { k: "seal_special", label: "Specials sealed", t: "chk", why: "Special moves cannot be used." },
      { k: "seal_jump", label: "Jump sealed", t: "chk", why: "Cannot jump. The fighter turns purple when the seal acts.", ev: "Your jump seal seen in Glass Cannon." },
      { k: "seal_guard", label: "Guard sealed", t: "chk", why: "Cannot block. The fighter turns purple.", ev: "Your guard seal seen in Ghost Survival." },
      { k: "no_ik", label: "Instant Kill sealed", t: "chk", why: "Instant Kill cannot be used. The panel shows - instead of OK." },
    ]],
    ["Other", [
      { k: "invisible", label: "Invisible", t: "chk", why: "The fighter fades. Only Chipp is known to respond (Mission 21).", ev: "Set on EX Order-Sol it reached the game's data but he stayed visible." },
      { k: "gimmick", label: "Character gimmick", t: "num", why: "Per-character state, 0 or 1 (Eddie, Zappa and Testament use 1). What it does depends on the character." },
    ]],
    ["Unknown, keep stock", [
      { k: "x08", label: "x08", t: "num", why: "Unknown. 0 in every mission." },
      { k: "x30", label: "x30", t: "num", why: "Unknown. 0 in every mission." },
    ]],
  ];
  const RULES = [
    { k: "clear", label: "Clear condition", t: "seg", why: "How the mission is won: Judge (most life at time-up, or a KO), Beat the enemy (KO), or Survive until time-up.", ev: "Judge cleared by a KO and Survive cleared at time-up, both on custom slots." },
    { k: "time", label: "Time", t: "time", why: "Seconds, 1 to 99. Infinity removes the timer.", ev: "20, 30 and 77 seconds seen." },
    { k: "stage", label: "Stage", t: "sel", opts: "stage", why: "Stage id, -1 (the opponent's stage) or 0 to 40. Overriding the stage is not tested, and the names are not known." },
    { k: "bgm", label: "Music", t: "sel", opts: "bgm", why: "Music id, 0 (the opponent's theme) to 40. Not tested; the names are not known." },
  ];
  const UNKNOWN_COMMON = [
    { k: "x52", label: "x52", t: "num", why: "Unknown. -1 in every mission." },
    { k: "x58", label: "x58", t: "num", why: "Unknown. 1 in every mission." },
    { k: "cpu_off", label: "cpu_off", t: "num", why: "0 in every mission. Nonzero should switch the opponent's AI off; not tested." },
    { k: "x7a", label: "x7a", t: "num", why: "Unknown flag. 0 in Missions 1, 4, 6, 9, 11 and 18; 1 elsewhere." },
  ];
  const SPEC = {};
  for (const [, rows] of SIDE_GROUPS) for (const f of rows) SPEC[f.k] = f;
  for (const f of [...RULES, ...UNKNOWN_COMMON]) SPEC[f.k] = f;

  // ---- state ----
  let state = { m: 1, edits: {} };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && s.edits && typeof s.edits === "object") state = { m: Math.min(30, Math.max(1, +s.m || 1)), edits: s.edits };
  } catch {}
  const h = /^#m(\d{1,2})$/.exec(location.hash);
  if (h && +h[1] >= 1 && +h[1] <= 30) state.m = +h[1];
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };
  const stock = (m) => D.STOCK[m - 1];
  const val = (m, side, k) => {
    const e = state.edits[m];
    return e && e[side] && k in e[side] ? e[side][k] : stock(m)[side][k];
  };
  const changedN = (m) => {
    const e = state.edits[m];
    return e ? Object.keys(e.p).length + Object.keys(e.e).length + Object.keys(e.c).length : 0;
  };
  const clamp = (k, v) => {
    const L = D.LIMITS[k];
    return L ? Math.max(L[0], Math.min(L[1], v)) : v;
  };
  const set = (m, side, k, v) => {
    const e = state.edits[m] || (state.edits[m] = { p: {}, e: {}, c: {} });
    if (v === stock(m)[side][k]) delete e[side][k];
    else e[side][k] = v;
    if (!changedN(m)) delete state.edits[m];
    save();
  };
  const cname = (id) => D.CHARS[id] || `#${id}`;
  const sideName = { p: "you", e: "opponent", c: "mission" };

  // ---- fmt of a stock value, for the reset link ----
  function fmt(k, v) {
    if (k === "char") return cname(v);
    if (k === "time") return v < 0 ? "infinity" : `${v}s`;
    if (k === "clear") return CLEAR[v] || v;
    if (k === "stage") return v < 0 ? "opponent's" : `#${v}`;
    if (k === "bgm") return v <= 0 ? "opponent's" : `#${v}`;
    const o = SPEC[k] && Array.isArray(SPEC[k].opts) && SPEC[k].opts.find((x) => x[0] === v);
    if (o) return o[1];
    if (SPEC[k] && SPEC[k].t === "chk") return v ? "on" : "off";
    return String(v);
  }

  // ---- controls ----
  const idOpts = (k, base, baseVal) => {
    const L = D.LIMITS[k];
    const list = k === "stage" ? D.STAGES : D.BGMS;
    const bv = baseVal;
    const o = [[bv, base]];
    for (let i = Math.max(0, L[0]); i <= L[1]; i++) if (i !== bv) o.push([i, list && list[i] ? list[i] : `#${i}`]);
    return o;
  };
  function optsFor(f, side) {
    if (f.opts === "char") return D.CHARS.map((n, i) => [i, n]).filter(([i]) => !(side === "e" && i === 0));
    if (f.opts === "stage") return idOpts("stage", "Opponent's stage", -1);
    if (f.opts === "bgm") return idOpts("bgm", "Opponent's theme", 0);
    return f.opts;
  }
  const aria = (f, side) => `${f.label}${side === "c" ? "" : ` (${sideName[side]})`}`;
  function control(f, side) {
    const k = f.k;
    const a = `data-s="${side}" data-k="${k}"`;
    const lab = esc(aria(f, side));
    if (f.t === "num") {
      const L = D.LIMITS[k] || [-32768, 32767];
      return `<input type="number" class="in" ${a} min="${L[0]}" max="${L[1]}" step="${f.step || 1}" aria-label="${lab}">`;
    }
    if (f.t === "sel") return `<select class="in" ${a} aria-label="${lab}">${optsFor(f, side).map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join("")}</select>`;
    if (f.t === "chk") return `<input type="checkbox" ${a} aria-label="${lab}">`;
    if (f.t === "seg")
      return `<span class="seg" role="group" aria-label="${lab}">${CLEAR.map((n, i) => `<button type="button" ${a} data-seg="${i}" aria-pressed="false">${esc(n)}</button>`).join("")}</span>`;
    if (f.t === "time")
      return `<input type="number" class="in" ${a} min="1" max="99" step="1" aria-label="Time in seconds"> <label class="inf"><input type="checkbox" data-inf="1" aria-label="No time limit"> infinity</label>`;
    return "";
  }
  const reset = (side, k) => `<button type="button" class="linkbtn rs" data-rs="${side}.${k}" hidden></button>`;
  const cell = (f, side) => `<td data-cell="${side}.${f.k}">${control(f, side)}${reset(side, f.k)}</td>`;

  function buildStatic() {
    // slots
    $("#slots").innerHTML = Array.from({ length: 30 }, (_, i) => {
      const m = i + 1;
      return `<button type="button" class="slot${m > LAST ? " lock" : ""}" data-m="${m}"${m > LAST ? ' title="Appears in the game after Missions 1 to 25 are cleared"' : ""}><b>${String(m).padStart(2, "0")}</b><small></small><i class="dot" hidden></i></button>`;
    }).join("");
    // rules
    $("#rulebody").innerHTML =
      `<table class="kv rules">${RULES.map((f) => `<tr><th><span>${esc(f.label)}</span></th><td data-cell="c.${f.k}">${control(f, "c")}${reset("c", f.k)} <span class="why">${status(f.k)} ${esc(f.why)}${f.ev ? ` <small>Seen: ${esc(f.ev)}</small>` : ""}</span></td></tr>`).join("")}</table>` +
      `<details class="adv"><summary>Unknown fields, leave alone</summary><table class="kv rules">${UNKNOWN_COMMON.map((f) => `<tr><th><span>${esc(f.label)}</span></th><td data-cell="c.${f.k}">${control(f, "c")}${reset("c", f.k)} <span class="why">${status(f.k)} ${esc(f.why)}</span></td></tr>`).join("")}</table></details>`;
    // fighters
    $("#ftable tbody").innerHTML = SIDE_GROUPS.map(
      ([g, rows]) =>
        `<tr class="grp"><td colspan="4">${esc(g)}</td></tr>` +
        rows.map((f) => `<tr><th scope="row" title="${esc(f.why)}">${esc(f.label)}</th>${cell(f, "p")}${cell(f, "e")}<td class="hide-sm">${status(f.k)}</td></tr>`).join(""),
    ).join("");
    // examples
    $("#extable tbody").innerHTML = D.EXAMPLES.map(
      (x, i) => `<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.note || "")}</small></td><td class="num">${x.slot}</td><td>${x.proven ? badge("emulator", "Run in the emulator: the panel, the fight and, for the custom missions, a cleared mission.") : badge("unknown", "Not run yet.")}</td><td><button type="button" data-ex="${i}">Load</button></td></tr>`,
    ).join("");
    // field table
    $("#fieldtable tbody").innerHTML = D.FIELDS.map((f) => {
      const s = SPEC[f.key] || { why: "" };
      const off = (n) => "+0x" + n.toString(16).toUpperCase().padStart(2, "0");
      const L = D.LIMITS[f.key];
      return `<tr><td><code>${esc(f.key)}</code></td><td>${esc(s.why)}${s.ev ? ` <small>Seen: ${esc(s.ev)}</small>` : ""}</td><td class="num">${L ? `${L[0]} to ${L[1]}` : ""}</td><td class="num">${f.e == null ? off(f.p) : `${off(f.p)} / ${off(f.e)}`}</td><td>${status(f.key)}</td></tr>`;
    }).join("");
  }

  // ---- panel readout: what the game's info screen prints for the current values (rules from 25 shots of the real panel) ----
  function readout(m) {
    const r = D.panel((side, k) => val(m, side, k));
    const long = (a) => a.some((l) => l.length > 16);
    const cellOf = (a) => esc(a.join("\n")).replace(/\n/g, "<br>") + (long(a) ? ' <small title="The game draws long lines past their column and clips them at the panel edge.">runs long</small>' : "");
    return `<h3 class="sh">Info screen readout</h3><table class="kv readout">${r.top.map(([a, b]) => `<tr><th>${a}</th><td>${esc(b)}</td></tr>`).join("")}</table>` +
      `<div class="tablewrap"><table class="grid readout"><thead><tr><th></th><th>PLAYER</th><th>ENEMY</th></tr></thead><tbody>${r.rows.map(([a, p, e]) => `<tr><td>${a}</td><td>${cellOf(p)}</td><td>${cellOf(e)}</td></tr>`).join("")}</tbody></table></div>` +
      `<p class="note"><small>${changedN(m) ? "Worked out from your values." : "The stock mission."} The game never prints your EX or colour. The screenshot is always the stock disc.</small></p>`;
  }

  const SHOTS = window.MISSION_SHOTS || { info: {}, fights: {} };
  function figure(m) {
    const info = SHOTS.info[m];
    if (!info) {
      if (!Object.keys(SHOTS.info).length) return `<div class="shot none"><p>Screenshot not in this build.</p></div>`;
      return `<div class="shot none"><p><b>No capture for Mission ${m} in this build.</b></p></div>`;
    }
    const f = `/assets/missions/${info.file}`;
    const note = m > LAST ? "Unlocked by clearing Missions 1 to 25 (Sol, via a code on a throwaway card); this mission itself is uncleared." : "";
    let h = `<figure class="shot"><a href="${f}" target="_blank" rel="noopener"><img src="${f}" width="640" height="448" alt="Accent Core Plus PS2 Mission ${m} info screen, stock"></a><figcaption>Mission ${m}, stock info screen (PS2 US). ${note}</figcaption></figure>`;
    const fight = SHOTS.fights[m];
    if (fight) {
      const g = `/assets/missions/${fight.file}`;
      h += `<figure class="shot fightshot"><a href="${g}" target="_blank" rel="noopener"><img src="${g}" width="640" height="448" alt="Accent Core Plus PS2 Mission ${m} in play" loading="lazy"></a><figcaption>${esc(fight.caption)}</figcaption></figure>`;
    }
    return h;
  }

  // ---- refresh: push state into every control, flags and outputs ----
  function sync() {
    const m = state.m;
    for (const el of $$("[data-s][data-k]")) {
      const s = el.dataset.s;
      const k = el.dataset.k;
      const v = val(m, s, k);
      if (el.dataset.seg !== undefined) el.setAttribute("aria-pressed", String(+el.dataset.seg === v));
      else if (el.type === "checkbox") el.checked = !!v;
      else if (SPEC[k].t === "time") {
        el.disabled = v < 0;
        const next = v < 0 ? "" : String(v);
        if (el.value !== next) el.value = next;
        $("[data-inf]").checked = v < 0;
      } else if (el.value !== String(v)) el.value = String(v);
      if (el.tagName === "SELECT" && !el.querySelector(`option[value="${v}"]`)) {
        el.insertAdjacentHTML("beforeend", `<option value="${v}">#${v}</option>`);
        el.value = String(v);
      }
    }
    for (const td of $$("[data-cell]")) {
      const [s, k] = td.dataset.cell.split(".");
      const v = val(m, s, k);
      const sv = stock(m)[s][k];
      const ch = v !== sv;
      td.classList.toggle("chg", ch);
      const b = $("button.rs", td);
      b.hidden = !ch;
      b.textContent = ch ? `reset (stock ${fmt(k, sv)})` : "";
    }
    // slots
    for (const b of $$("#slots .slot")) {
      const n = +b.dataset.m;
      b.setAttribute("aria-current", String(n === m));
      $("small", b).textContent = cname(val(n, "e", "char")).toUpperCase();
      $(".dot", b).hidden = !changedN(n);
      b.title = (n > LAST ? "Appears in the game after Missions 1 to 25 are cleared. " : "") + (changedN(n) ? `${changedN(n)} changed` : "");
    }
    $("#msread").innerHTML = readout(m);
    // output
    const txt = D.encodeOne(state.edits);
    const writes = txt ? txt.split("\n").filter((l) => l.indexOf("patch=") === 0).length : 0;
    const ms = Object.keys(state.edits).length;
    $("#pn").textContent = txt || "// No changes yet. Pick a mission and change a setting.\n";
    $("#pnmeta").textContent = writes ? `${writes} ${writes > 1 ? "writes" : "write"}, ${ms} ${ms > 1 ? "missions" : "mission"}` : "No changes";
    $(".copy", root).disabled = !writes;
    $("#clearall").disabled = !ms;
    const dl = $("#pndl");
    if (dl.dataset.url) URL.revokeObjectURL(dl.dataset.url);
    if (writes) {
      dl.dataset.url = dl.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
      dl.removeAttribute("aria-disabled");
    } else {
      delete dl.dataset.url;
      dl.href = "#";
      dl.setAttribute("aria-disabled", "true");
    }
  }
  let shownFig = 0;
  function showMission() {
    if (shownFig !== state.m) {
      $("#msfig").innerHTML = figure(state.m);
      shownFig = state.m;
    }
    sync();
  }

  // ---- events ----
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.inf !== undefined) {
      set(state.m, "c", "time", el.checked ? -1 : 60);
      return sync();
    }
    const s = el.dataset.s;
    const k = el.dataset.k;
    if (!s || el.dataset.seg !== undefined) return;
    let v;
    if (el.type === "checkbox") v = el.checked ? 1 : 0;
    else {
      v = parseInt(el.value, 10);
      if (isNaN(v)) return sync();
      v = SPEC[k].t === "time" ? Math.max(1, Math.min(99, v)) : clamp(k, v);
    }
    set(state.m, s, k, v);
    sync();
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.dataset.seg !== undefined) {
      set(state.m, b.dataset.s, b.dataset.k, +b.dataset.seg);
      sync();
    } else if (b.dataset.rs) {
      const [s, k] = b.dataset.rs.split(".");
      set(state.m, s, k, stock(state.m)[s][k]);
      sync();
    } else if (b.classList.contains("slot")) {
      state.m = +b.dataset.m;
      save();
      history.replaceState(null, "", `#m${state.m}`);
      showMission();
    } else if (b.dataset.ex !== undefined) {
      const x = D.EXAMPLES[+b.dataset.ex];
      delete state.edits[x.slot];
      for (const s of ["p", "e", "c"]) for (const k of Object.keys(x[s] || {})) set(x.slot, s, k, x[s][k]);
      if (x.pos) for (const s of Object.keys(x.pos)) set(x.slot, s, "position", x.pos[s]);
      state.m = x.slot;
      save();
      history.replaceState(null, "", `#m${state.m}`);
      showMission();
      $("#pick").scrollIntoView({ block: "start" });
    } else if (b.id === "clearall") {
      state.edits = {};
      save();
      sync();
    }
  });
  $("#pndl").addEventListener("click", (e) => {
    if ($("#pndl").getAttribute("aria-disabled")) e.preventDefault();
  });

  buildStatic();
  showMission();
})();
