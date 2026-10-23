import { esc } from "./lib.ts";
import type { Release } from "./model.ts";

export function patchInstallHtml(release: Pick<Release, "serial" | "crc">): string {
  const filename: string = `${release.serial}_${release.crc}.pnach`;
  return `<ol><li>In PCSX2, choose <b>Tools &gt; Open Data Directory</b> and open <code>patches</code>.</li><li>Save this download there as <code>${esc(filename)}</code>. Portable example: <code>${esc(`<PCSX2 folder>\\patches\\${filename}`)}</code>.</li><li>Right-click the game, open <b>Properties &gt; Patches</b>, reload the list if needed, and enable the intended named patch sections and their required dependencies.</li><li>Start the game from a fresh boot. Follow this feature's setup, controls, conflicts and recovery instructions.</li></ol><p>Keep alternative modules separate. The ZIP is an archive of alternatives; do not enable everything together.</p>`;
}

export function patchInstallSummary(): string {
  return 'Selectable feature downloads go in <code>patches</code> and use <b>Properties &gt; Patches</b>. Legacy release cheat files use <code>cheats</code> and <b>Properties &gt; Cheats &gt; Enable Cheats</b>. <a href="/how-to/">Placement and setup</a>.';
}
