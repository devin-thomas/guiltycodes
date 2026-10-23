import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSearch } from "../src/search.ts";
import { array, list, record, number, text } from "../build/validate.ts";
import { parseLocalRules } from "../build/lib.ts";
import { patchInstallHtml, patchInstallSummary } from "../build/install.ts";

test("search accepts the published schema and rejects malformed fields and unsafe destinations", () => {
  const entry = { t: "CPU modes", g: "AC+", r: "US SLUS-21847", s: "VERIFIED", u: "/games/acplus/us/cpu-modes-us/", x: "cpu modes" };
  assert.deepEqual(parseSearch([entry]), [entry]);
  for (const invalid of [
    null,
    {},
    [null],
    [{ ...entry, t: 2 }],
    [{ ...entry, s: "APPROVED" }],
    [{ ...entry, u: "javascript:alert(1)" }],
    [{ ...entry, x: undefined }],
  ]) {
    assert.throws(() => parseSearch(invalid), /[Ss]earch/);
  }
});

test("boundary parsers preserve strings and ordered duplicate writes and reject invalid values", () => {
  assert.equal(text(" code ", "title"), " code ");
  assert.deepEqual(list(["E0010001 10123450", "E0010001 10123450"], "raw", { unique: false }), ["E0010001 10123450", "E0010001 10123450"]);
  assert.deepEqual(array([1], "array"), [1]);
  assert.deepEqual(record({ value: 1 }, "object"), { value: 1 });
  assert.equal(number(1, "count"), 1);
  assert.throws(() => text(" ", "title"), /nonempty/);
  assert.throws(() => list([1], "controls"), /nonempty text/);
  assert.throws(() => list([], "controls", { nonempty: true }), /at least one/);
  assert.throws(() => list(["a", "a"], "controls"), /duplicates/);
  assert.throws(() => record([], "object"), /object/);
  assert.throws(() => number(Infinity, "count"), /finite/);
});

test("sectioned feature installation distinguishes patches from legacy cheats", () => {
  const html = patchInstallHtml({ serial: "SLUS-21847", crc: "F233A433" });
  assert.match(html, /Tools &gt; Open Data Directory/);
  assert.match(html, /<code>patches<\/code>/);
  assert.match(html, /&lt;PCSX2 folder&gt;\\patches\\SLUS-21847_F233A433\.pnach/);
  assert.match(html, /Properties &gt; Patches/);
  assert.match(html, /intended named patch sections and their required dependencies/);
  assert.match(html, /fresh boot/);
  assert.match(patchInstallSummary(), /Properties &gt; Cheats &gt; Enable Cheats/);
  assert.doesNotMatch(html, /E:\\/);
});

test("local sanitizing rules allow removal replacements and reject malformed configuration", () => {
  const rules = parseLocalRules({ private: ["private/path"], replace: [["secret", ""]] });
  assert.equal("remove secret".replace(...rules.replace[0]), "remove ");
  assert.throws(() => parseLocalRules({ replace: [["only one value"]] }), /pattern and replacement/);
  assert.throws(() => parseLocalRules({ replace: [["pattern", 1]] }), /pattern and replacement/);
  assert.throws(() => parseLocalRules({ replace: [["[", ""]] }), SyntaxError);
});
