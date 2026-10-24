// Checks the built Mission Editor data layer (dist/assets) against the mission research:
//   1. the 21 encoder vectors (tests/mission_vectors.json, copied into data/mission-editor.json by tools/mission-data.py)
//   2. the info-screen readout against the 25 panel tests (tests/panel/RESULTS.md, shots of the real panel)
//   3. optionally, that the three proven custom missions and the Mission 1 demo give the same record as their pnach files
//
//   node tools/check-mission-encoder.mjs [--custom <captures>/ggacplus-missions/custom] [--demo <...mission1-demo.pnach>]
//
// Vectors are checked as the web editor works: stock-base vectors compare the patch lines (as a set, order may differ);
// neutral-base vectors compare the record the patches leave (the editor never writes a value equal to stock, so it has
// fewer lines than genmission.py but the same result). Text edits and the JP region are not features of the web editor.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["mission-stock.js", "mission-data.js"]) vm.runInContext(fs.readFileSync(`dist/assets/${f}`, "utf8"), ctx);
const D = ctx.MISSION_DATA;
const data = JSON.parse(fs.readFileSync("data/mission-editor.json", "utf8"));
let pass = 0, fail = 0, skip = 0;
const bad = (m) => { fail++; console.log("FAIL", m); };
const ok = () => { pass++; };

// ---- resolving genmission.py's vocabulary ----
const SCH = Object.fromEntries(D.SCHEMA.fields.map((f) => [f.name, f]));
const isCommon = (f) => f.side === "common";
const word = (f, v) => {
  if (typeof v === "number") return v;
  const hit = Object.entries(f.values || {}).find(([, w]) => w.toUpperCase().replace(/ \(.*$/, "") === String(v).toUpperCase());
  if (hit) return +hit[0];
  if (f.name === "time" && String(v).toUpperCase() === "INFINITY") return -1;
  throw new Error(`"${v}" is not a number`);
};
function resolve(input, { force = false } = {}) {
  if (!(input.slot >= 1 && input.slot <= 30)) throw new Error("slot must be 1-30");
  const set = { p: {}, e: {}, c: {} };
  for (const [key, raw] of Object.entries(input.fields || {})) {
    let side = null, name = key;
    if (key === "enemy") { side = "e"; name = "char"; }
    else if (/^[pe]\./.test(key)) { side = key[0]; name = key.slice(2); }
    const f = SCH[name];
    if (!f) throw new Error("unknown field");
    if (isCommon(f) && side) throw new Error("common field");
    const v = word(f, raw);
    if (!force) {
      let [lo, hi] = D.LIMITS[name];
      if (name === "time" && v === 0) throw new Error("time 0");
      if (name === "char" && side === "e") lo = 1;
      if (v !== -1 || name !== "time") if (v < lo || v > hi) throw new Error(`outside ${lo}..${hi}`);
    }
    if (isCommon(f)) set.c[name] = v;
    else for (const s of side ? [side] : ["p", "e"]) set[s][name] = v;
  }
  return set;
}
const patches = (t) => t.split(/\r?\n/).filter((l) => l.startsWith("patch=")).sort();
const addrOf = (slot, off) => 0x302be0 + (slot - 1) * 0x80 + off;
function stockState(slot) {
  const st = D.STOCK[slot - 1], m = new Map();
  for (const f of D.FIELDS) {
    if (f.e == null) m.set(addrOf(slot, f.p), st.c[f.key] & 0xffff);
    else { m.set(addrOf(slot, f.p), st.p[f.key] & 0xffff); m.set(addrOf(slot, f.e), st.e[f.key] & 0xffff); }
  }
  return m;
}
function applied(slot, lines) {
  const m = stockState(slot);
  for (const l of lines) {
    const x = /^patch=1,EE,1([0-9A-F]{7}),extended,([0-9A-F]{8})$/.exec(l);
    if (!x) continue;
    const a = parseInt(x[1], 16);
    if (m.has(a)) m.set(a, parseInt(x[2], 16) & 0xffff);
  }
  return m;
}
const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

// ---- 1. the 21 vectors ----
for (const v of data.vectors) {
  const i = v.input;
  try {
    if (i.text || i.region === "jp") { skip++; console.log("SKIP", v.name, "(text edits and the JP region are not web editor features)"); continue; }
    if (v.error) {
      let err = null;
      try { resolve(i, { force: !!i.force }); } catch (e) { err = e.message; }
      if (err && err.includes(v.error)) ok(); else bad(`${v.name}: expected error "${v.error}", got ${err}`);
      continue;
    }
    const set = resolve(i, { force: !!i.force });
    const stockBase = i.base === "stock";
    const over = stockBase ? set : D.neutral(set);
    const edits = { [i.slot]: over };
    const lines = patches(D.encode(edits));
    const one = patches(D.encodeOne(edits));
    if (JSON.stringify(lines) !== JSON.stringify(one)) { bad(`${v.name}: encodeOne patch lines differ from encode`); continue; }
    if (stockBase) {
      if (JSON.stringify(lines) === JSON.stringify([...v.expected].sort())) ok();
      else bad(`${v.name}\n  want ${JSON.stringify([...v.expected].sort())}\n  got  ${JSON.stringify(lines)}`);
    } else if (same(applied(i.slot, lines), applied(i.slot, v.expected))) ok();
    else bad(`${v.name}: the record left by the patches differs`);
  } catch (e) { bad(`${v.name}: ${e.message}`); }
}
console.log(`vectors: ${data.vectors.length} (${skip} not web editor features)`);

// ---- 2. the readout against the real panel (tests/panel/RESULTS.md) ----
const E = {
  1: { SEAL: [["SPECIAL:JUMP"], ["SPECIAL:GUARD"]] },
  3: { LIFE: [["420:REGAIN:POISON"], ["420:REGAIN:HEAL"]] },
  4: { LIFE: [["420:REGAIN:HEAL"], ["420:REGAIN:POISON"]] },
  5: { LIFE: [["420:REGAIN:HEAL:POISON"], ["420:HEAL:POISON"]] },
  6: { ENEMY: "KY:BLACK" }, 7: { ENEMY: "KY:GOLD" }, 8: { ENEMY: "KY:EX:BLACK" }, 9: { ENEMY: "ORDER-SOL:EX:GOLD" },
  10: { TIME: "77", LIFE: [["377"], ["177"]], "GUARD LEVEL": [["7"], ["-7"]], TENSION: [["7000:NORMAL"], ["777:NORMAL"]], "COMBO DAMAGE": [["OVER 7"], ["UNDER 7"]] },
  11: { DAMAGE: [["TO GROUND", "ALL"], ["TO AIR", "ALL"]] },
  12: { "PSYCH BURST": [["INFINITY"], ["-"]] },
  13: { "INSTANT KILL": [["OK"], ["-"]] },
  14: { TENSION: [["5000:NO"], ["10000:HOLD"]] },
  15: { "GUARD LEVEL": [["-128"], ["-1"]] },
  16: { DAMAGE: [["DEAD ANGLE", "SPECIAL", "OVERDRIVE"], ["NORMAL", "OVERDRIVE"]] },
  17: { DAMAGE: [["NONE"], ["ALL"]] },
  18: { DAMAGE: [["DEAD ANGLE", "OVERDRIVE"], ["DEAD ANGLE"]] },
  19: { TIME: "INFINITY", CLEAR: "JUDGE" },
  20: { TIME: "100", CLEAR: "TIME UP" },
  21: { "COMBO DAMAGE": [["OVER 3"], ["UNDER 1"]] },
  22: { ENEMY: "JUSTICE:EX:GOLD" },
  23: { LIFE: [["1"], ["420"]], "GUARD LEVEL": [["128"], ["-120"]] },
  24: { LIFE: [["420:REGAIN"], ["420"]] },
  25: { TIME: "99", CLEAR: "BEAT ENEMY", ENEMY: "SOL", LIFE: [["420"], ["420"]], TENSION: [["0:NORMAL"], ["0:NORMAL"]], "PSYCH BURST": [["OK"], ["OK"]], SEAL: [["-"], ["-"]], "COMBO DAMAGE": [["-"], ["-"]], "INSTANT KILL": [["-"], ["-"]], DAMAGE: [["ALL"], ["ALL"]] },
};
let pp = 0, pf = 0, pl = 0;
for (const t of data.panel_tests) {
  const exp = E[t.slot];
  if (!exp) continue;
  const rec = D.neutral(resolve({ slot: t.slot, fields: t.fields }, { force: true }));
  const out = D.panel((s, k) => rec[s][k]);
  for (const [label, want] of Object.entries(exp)) {
    pl++;
    const top = out.top.find(([l]) => l === label);
    const row = out.rows.find(([l]) => l === label);
    const got = top ? top[1] : [row[1], row[2]];
    if (JSON.stringify(got) === JSON.stringify(want)) pp++;
    else { pf++; bad(`panel test ${t.slot} ${label}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
  }
}
console.log(`panel readout: ${pp}/${pl} lines match the real panel (${data.panel_tests.length} tests, ${Object.keys(E).length} with transcribed lines)`);

// ---- 3. the proven custom missions and the demo give the same record as their pnach ----
function recordOf(slot, file) {
  const m = stockState(slot);
  for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const x = /^patch=1,EE,1([0-9A-F]{7}),extended,([0-9A-F]{8})$/.exec(l);
    if (x && m.has(parseInt(x[1], 16))) m.set(parseInt(x[1], 16), parseInt(x[2], 16) & 0xffff);
  }
  return m;
}
const custom = arg("--custom"), demo = arg("--demo");
const pairs = [];
if (demo) pairs.push(["Mission 1 demo", 0, demo]);
if (custom) for (const [i, f] of [["Poison Sprint", "poison-sprint"], ["Glass Cannon", "glass-cannon"], ["Ghost Survival", "ghost-survival"]].entries()) pairs.push([f[0], i + 1, path.join(custom, f[1], `SLUS-21847_F233A433.${f[1]}.pnach`)]);
for (const [name, , file] of pairs) {
  const ex = D.EXAMPLES.find((x) => x.name.startsWith(name));
  if (!ex) { bad(`no example named ${name}`); continue; }
  const lines = patches(D.encodeOne({ [ex.slot]: { p: ex.p, e: ex.e, c: ex.c } }));
  if (same(applied(ex.slot, lines), recordOf(ex.slot, file))) { ok(); console.log(`example ${name}: same record as ${path.basename(file)} (${lines.length} writes)`); }
  else bad(`example ${name}: record differs from ${file}`);
}

console.log(`${fail ? "FAIL" : "OK"}: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
