import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSearch } from "../src/search.ts";
import type { SearchEntry } from "../src/search.ts";
import { parseArray, parseNumber, parseRecord, parseText, parseTextList } from "../build/validate.ts";
import { parseLocalRules } from "../build/lib.ts";
import type { LocalRules } from "../build/lib.ts";
import { patchInstallHtml, patchInstallSummary, patchSetupText } from "../build/install.ts";

test("search accepts the published schema and rejects malformed fields and unsafe destinations", (): void => {
  const entry: SearchEntry = {
    t: "CPU modes",
    g: "AC+",
    r: "US SLUS-21847",
    s: "VERIFIED",
    u: "/games/acplus/us/cpu-modes-us/",
    x: "cpu modes",
  };
  assert.deepEqual(parseSearch([entry]), [entry]);
  const invalidIndexes: readonly unknown[] = [
    null,
    {},
    [null],
    [{ ...entry, t: 2 }],
    [{ ...entry, s: "APPROVED" }],
    [{ ...entry, u: "javascript:alert(1)" }],
    [{ ...entry, x: undefined }],
  ];
  for (const invalid of invalidIndexes) {
    assert.throws((): readonly SearchEntry[] => parseSearch(invalid), /[Ss]earch/);
  }
});

test("boundary parsers preserve strings and ordered duplicate writes and reject invalid values", (): void => {
  assert.equal(parseText(" code ", "title"), " code ");
  assert.deepEqual(parseTextList(["E0010001 10123450", "E0010001 10123450"], "raw", { unique: false }), [
    "E0010001 10123450",
    "E0010001 10123450",
  ]);
  assert.deepEqual(parseArray([1], "array"), [1]);
  assert.deepEqual(parseRecord({ value: 1 }, "object"), { value: 1 });
  assert.equal(parseNumber(1, "count"), 1);
  assert.throws((): string => parseText(" ", "title"), /nonempty/);
  assert.throws((): readonly string[] => parseTextList([1], "controls"), /nonempty text/);
  assert.throws((): readonly string[] => parseTextList([], "controls", { nonempty: true }), /at least one/);
  assert.throws((): readonly string[] => parseTextList(["a", "a"], "controls"), /duplicates/);
  assert.throws((): Record<string, unknown> => parseRecord([], "object"), /object/);
  assert.throws((): number => parseNumber(Infinity, "count"), /finite/);
});

test("sectioned feature installation distinguishes patches from legacy cheats", (): void => {
  const html: string = patchInstallHtml({ serial: "SLUS-21847", crc: "F233A433" });
  assert.match(html, /Tools &gt; Open Data Directory/);
  assert.match(html, /<code>patches<\/code>/);
  assert.match(html, /&lt;PCSX2 folder&gt;\\patches\\SLUS-21847_F233A433\.pnach/);
  assert.match(html, /Properties &gt; Patches/);
  assert.match(html, /intended named patch sections and their required dependencies/);
  assert.match(html, /fresh boot/);
  assert.match(patchInstallSummary(), /Properties &gt; Cheats &gt; Enable Cheats/);
  assert.doesNotMatch(html, /E:\\/);
});

test("local sanitizing rules allow removal replacements and reject malformed configuration", (): void => {
  let rules: LocalRules = parseLocalRules({ private: ["private/path"], replace: [["secret", ""]] });
  let [pattern, replacement]: readonly [RegExp, string] = rules.replace[0] ?? assert.fail("expected one replacement rule");
  assert.equal("remove secret".replace(pattern, replacement), "remove ");
  assert.throws((): unknown => parseLocalRules({ replace: [["only one value"]] }), /pattern and replacement/);
  assert.throws((): unknown => parseLocalRules({ replace: [["pattern", 1]] }), /pattern and replacement/);
  assert.throws((): unknown => parseLocalRules({ replace: [["[", ""]] }), SyntaxError);
});

test("pinned module setup copy uses the patches UI while preserving gameplay instructions", (): void => {
  assert.equal(
    patchSetupText("In game Properties / Cheats, enable cheats and CPU Survival v1 (US). Reload cheats or restart PCSX2."),
    "In game Properties / Patches, enable CPU Survival v1 (US). Reload patches or restart PCSX2.",
  );
  assert.equal(
    patchSetupText("in the folder shown in PCSX2 Settings / Folders / Cheats"),
    "in the patches folder under Tools / Open Data Directory",
  );
  assert.equal(
    patchSetupText("in your configured cheats folder; enable cheats and the CPU Survival v1 (US) section before boot."),
    "in your active PCSX2 data directory's patches folder; enable the CPU Survival v1 (US) section before boot.",
  );
  const controls: string = "Hold physical R1 while confirming SURVIVAL; PLAYER LEVEL0-32. Respect/Dust uses your binding.";
  assert.equal(patchSetupText(controls), controls);
});
