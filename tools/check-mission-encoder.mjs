// Runs the shipped data layer (dist/assets) and compares encode() with a tested pnach, patch lines as a set (order may differ).
//   node tools/check-mission-encoder.mjs path/to/SLUS-21847_F233A433.mission1-demo.pnach
import vm from "node:vm";
import fs from "node:fs";
const ref = process.argv[2];
if (!ref) throw new Error("usage: node tools/check-mission-encoder.mjs <mission1-demo.pnach>");
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["mission-stock.js", "mission-data.js"]) vm.runInContext(fs.readFileSync(`dist/assets/${f}`, "utf8"), ctx);
const patches = (t) => t.split(/\r?\n/).filter((l) => l.startsWith("patch=")).sort();
const want = patches(fs.readFileSync(ref, "utf8"));
const got = patches(ctx.MISSION_DATA.encode({ 1: { p: { life: 210 }, e: { char: 2 }, c: { time: 30 } } }));
const ok = JSON.stringify(want) === JSON.stringify(got);
console.log(ok ? "MATCH" : "MISMATCH", { want, got });
process.exit(ok ? 0 : 1);
