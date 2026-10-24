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

  // ---- evidence: v VERIFIED (run on Mission 1), i INFERRED (same mechanism), n NOT TESTED ----
  const ST = { v: ["VERIFIED", "st-verified"], i: ["INFERRED", "st-inferred"], n: ["NOT TESTED", "st-not-tested"] };
  const badge = (s, title) => `<span class="st ${ST[s][1]}"${title ? ` title="${esc(title)}"` : ""}>${ST[s][0]}</span>`;
  const PROVEN = "Run on Mission 1: the enemy, the time and your start life.";

  // ---- field layout: one entry per field, grouped. t: num | sel | chk. ----
  const CLEAR = ["Judge", "Beat the enemy", "Survive to time-up"];
  const SIDE_GROUPS = [
    ["Fighter", [
      { k: "char", label: "Character", t: "sel", opts: "char", st: "v", why: "The fighter. On your side 0 means whoever you pick; the tested edit changes the opponent." },
      { k: "sp", label: "Colour", t: "sel", opts: [[0, "Normal"], [1, "Gold"], [2, "Black"]], st: "i", why: "Normal, Gold or Black version." },
      { k: "ex", label: "EX version", t: "chk", st: "i", why: "The EX version of the character." },
      { k: "colour", label: "Palette", t: "num", st: "i", why: "Colour slot, used when Colour is Normal." },
    ]],
    ["Life", [
      { k: "life", label: "Start life", t: "num", st: "v", why: "Life at the start. 420 is a full bar. The tested edit changes yours." },
      { k: "regain", label: "Regain", t: "num", st: "i", why: "Recoverable life (the :REGAIN tag). 1 is on." },
      { k: "heal", label: "Heal", t: "num", st: "i", why: "Life regeneration (:HEAL). 1 is on." },
      { k: "poison", label: "Poison", t: "num", st: "i", why: "Poison (:POISON). 1 is on." },
    ]],
    ["Tension, guard and burst", [
      { k: "tension_mode", label: "Tension", t: "sel", opts: [[0, "Normal"], [1, "None"], [2, "Hold"]], st: "i", why: "How Tension behaves: normal, none, or held." },
      { k: "tension", label: "Start Tension", t: "num", step: 100, st: "i", why: "Tension at the start. 10000 is full." },
      { k: "guard", label: "Guard level", t: "num", st: "i", why: "Guard level from -120 (weakest) to 128 (safest)." },
      { k: "burst", label: "Psych Burst", t: "sel", opts: [[0, "None"], [1, "OK"], [2, "Infinite"]], st: "i", why: "Psych Burst: none, available, or unlimited." },
    ]],
    ["Damage rules", [
      { k: "no_normal", label: "No normal damage", t: "chk", st: "i", why: "Normal moves deal no damage." },
      { k: "no_special", label: "No special damage", t: "chk", st: "i", why: "Special moves deal no damage." },
      { k: "no_overdrive", label: "No Overdrive damage", t: "chk", st: "i", why: "Overdrives deal no damage." },
      { k: "dead_angle", label: "Dead Angle damages", t: "chk", st: "i", why: "Dead Angle Attacks deal damage." },
      { k: "combo_over", label: "Combo: only after hit N", t: "num", st: "i", why: "Only hits after the Nth hit of a combo count (COMBO DAMAGE OVER n)." },
      { k: "combo_under", label: "Combo: first N hits only", t: "num", st: "i", why: "Only the first N hits of a combo count (UNDER n)." },
      { k: "position", label: "Hits count", t: "sel", opts: [[0, "Anywhere"], [1, "To ground"], [2, "To air"]], st: "i", why: "Damage only counts against grounded or airborne targets." },
    ]],
    ["Seals", [
      { k: "seal_special", label: "Specials sealed", t: "chk", st: "i", why: "SEAL SPECIAL." },
      { k: "seal_jump", label: "Jump sealed", t: "chk", st: "i", why: "SEAL JUMP." },
      { k: "seal_guard", label: "Guard sealed", t: "chk", st: "i", why: "SEAL GUARD." },
      { k: "no_ik", label: "Instant Kill sealed", t: "chk", st: "i", why: "Instant Kill cannot be used. The panel shows - instead of OK." },
    ]],
    ["Other", [
      { k: "invisible", label: "Invisible", t: "chk", st: "i", why: "The fighter is invisible (Mission 21 uses it for Chipp)." },
      { k: "gimmick", label: "Character gimmick", t: "num", st: "i", why: "Per-character state (Eddie, Zappa and Testament use it)." },
    ]],
    ["Unknown, keep stock", [
      { k: "x08", label: "x08", t: "num", st: "n", why: "Unknown. 0 in every mission." },
      { k: "x30", label: "x30", t: "num", st: "n", why: "Unknown. 0 in every mission." },
    ]],
  ];
  const RULES = [
    { k: "clear", label: "Clear condition", t: "seg", st: "i", why: "How the mission is won: Judge (most life at time-up), Beat the enemy, or Survive until time-up." },
    { k: "time", label: "Time", t: "time", st: "v", why: "Seconds. Infinity removes the timer. The tested edit changes it." },
    { k: "stage", label: "Stage", t: "sel", opts: "stage", st: "n", why: "Stage id. -1 uses the opponent's stage. Names are not checked yet." },
    { k: "bgm", label: "Music", t: "sel", opts: "bgm", st: "n", why: "Music id. 0 uses the opponent's theme. Names are not checked yet." },
  ];
  const UNKNOWN_COMMON = [
    { k: "x52", label: "x52", t: "num", st: "n", why: "Unknown. -1 in every mission." },
    { k: "x58", label: "x58", t: "num", st: "n", why: "Unknown. 1 in every mission." },
    { k: "cpu_off", label: "cpu_off", t: "num", st: "n", why: "0 in every mission. Nonzero is thought to stop the CPU from fighting." },
    { k: "x7a", label: "x7a", t: "num", st: "n", why: "Unknown flag. 0 in Missions 1, 4, 6, 9, 11 and 18; 1 elsewhere." },
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
      `<table class="kv rules">${RULES.map((f) => `<tr><th><span>${esc(f.label)}</span></th><td data-cell="c.${f.k}">${control(f, "c")}${reset("c", f.k)} <span class="why">${badge(f.st, f.st === "v" ? PROVEN : "")} ${esc(f.why)}</span></td></tr>`).join("")}</table>` +
      `<details class="adv"><summary>Unknown fields, leave alone</summary><table class="kv rules">${UNKNOWN_COMMON.map((f) => `<tr><th><span>${esc(f.label)}</span></th><td data-cell="c.${f.k}">${control(f, "c")}${reset("c", f.k)} <span class="why">${badge(f.st)} ${esc(f.why)}</span></td></tr>`).join("")}</table></details>`;
    // fighters
    $("#ftable tbody").innerHTML = SIDE_GROUPS.map(
      ([g, rows]) =>
        `<tr class="grp"><td colspan="4">${esc(g)}</td></tr>` +
        rows.map((f) => `<tr><th scope="row" title="${esc(f.why)}">${esc(f.label)}</th>${cell(f, "p")}${cell(f, "e")}<td class="hide-sm">${badge(f.st, f.st === "v" ? PROVEN : "")}</td></tr>`).join(""),
    ).join("");
    // examples
    $("#extable tbody").innerHTML = D.EXAMPLES.map(
      (x, i) => `<tr><td>${esc(x.name)}</td><td class="num">${x.slot}</td><td>${x.proven ? badge("v", "The tested Mission 1 demo file.") : badge("n", "A placeholder; not run yet.")}</td><td><button type="button" data-ex="${i}">Load</button></td></tr>`,
    ).join("");
    // field table
    $("#fieldtable tbody").innerHTML = D.FIELDS.map((f) => {
      const s = SPEC[f.key] || { label: f.key, why: "", st: "n" };
      const off = (n) => "+0x" + n.toString(16).toUpperCase().padStart(2, "0");
      return `<tr><td><code>${esc(f.key)}</code></td><td>${esc(s.why)}</td><td class="num">${f.e == null ? off(f.p) : `${off(f.p)} / ${off(f.e)}`}</td><td>${badge(s.st, s.st === "v" ? PROVEN : "")}</td></tr>`;
    }).join("");
  }

  // ---- panel readout: what the game's info screen should print for the current values ----
  function readout(m) {
    const g = (s, k) => val(m, s, k);
    const t = g("c", "time");
    const tag = (s) => {
      const x = g(s, "sp");
      return `${g(s, "ex") ? ":EX" : ""}${x === 1 ? ":GOLD" : x === 2 ? ":BLACK" : ""}`;
    };
    const top = [
      ["TIME", t < 0 ? "INFINITY" : String(Math.min(t, 99))],
      ["CLEAR", ["JUDGE", "BEAT ENEMY", "TIME UP"][g("c", "clear")] || "?"],
      ["ENEMY", cname(g("e", "char")).toUpperCase() + tag("e")],
    ];
    const seals = (s) => {
      const l = [g(s, "seal_special") && "SPECIAL", g(s, "seal_jump") && "JUMP", g(s, "seal_guard") && "GUARD"].filter(Boolean);
      return l.length ? l.join(" ") : "-";
    };
    const dmg = (s) => {
      const un = [!g(s, "no_normal") && "NORMAL", !g(s, "no_special") && "SPECIAL", !g(s, "no_overdrive") && "OVERDRIVE"].filter(Boolean);
      const da = g(s, "dead_angle");
      let out;
      if (!un.length && !da) out = "NONE";
      else if (un.length === 3 && da) out = "ALL";
      else out = [...un, da && "DEAD ANGLE"].filter(Boolean).join(" ");
      const pos = g(s, "position");
      return out + (pos === 1 ? " TO GROUND" : pos === 2 ? " TO AIR" : "");
    };
    const combo = (s) => {
      const l = [g(s, "combo_over") > 0 && `OVER ${g(s, "combo_over")}`, g(s, "combo_under") > 0 && `UNDER ${g(s, "combo_under")}`].filter(Boolean);
      return l.length ? l.join(" ") : "-";
    };
    const rows = [
      ["LIFE", (s) => `${g(s, "life")}${g(s, "regain") ? ":REGAIN" : ""}${g(s, "heal") ? ":HEAL" : ""}${g(s, "poison") ? ":POISON" : ""}`],
      ["GUARD LEVEL", (s) => String(g(s, "guard"))],
      ["TENSION", (s) => `${g(s, "tension")}:${["NORMAL", "NO", "HOLD"][g(s, "tension_mode")] || "?"}`],
      ["PSYCH BURST", (s) => ["-", "OK", "INFINITY"][g(s, "burst")] || "?"],
      ["SEAL", seals],
      ["COMBO DAMAGE", combo],
      ["INSTANT KILL", (s) => (g(s, "no_ik") ? "-" : "OK")],
      ["DAMAGE", dmg],
    ];
    return `<h3 class="sh">Info screen readout</h3><table class="kv readout">${top.map(([a, b]) => `<tr><th>${a}</th><td>${esc(b)}</td></tr>`).join("")}</table>` +
      `<div class="tablewrap"><table class="grid readout"><thead><tr><th></th><th>PLAYER</th><th>ENEMY</th></tr></thead><tbody>${rows.map(([a, f]) => `<tr><td>${a}</td><td>${esc(f("p"))}</td><td>${esc(f("e"))}</td></tr>`).join("")}</tbody></table></div>` +
      `<p class="note"><small>${changedN(m) ? "Worked out from your values." : "The stock mission."} Wording follows the game's screen; the screenshot is always the stock disc.</small></p>`;
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
      if (ch) b.textContent = `reset (stock ${fmt(k, sv)})`;
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
    const txt = D.encode(state.edits);
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
