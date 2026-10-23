import { esc } from "./lib.ts";
import type { Release } from "./model.ts";

// Correct placement wording at presentation time without changing pinned research evidence.
export function patchSetupText(source: string): string {
  return source
    .replaceAll("the folder shown in PCSX2 Settings / Folders / Cheats", "the patches folder under Tools / Open Data Directory")
    .replaceAll("the cheats folder shown in PCSX2 Settings / Folders", "the patches folder under Tools / Open Data Directory")
    .replaceAll("the PCSX2 configured cheats folder", "the PCSX2 active data directory's patches folder")
    .replaceAll("your configured cheats folder", "your active PCSX2 data directory's patches folder")
    .replaceAll("Properties / Cheats, enable cheats and", "Properties / Patches, enable")
    .replaceAll("Enable cheats and", "Enable")
    .replaceAll("enable cheats and the", "enable the")
    .replaceAll("Reload cheats", "Reload patches")
    .replaceAll("disable the cheat and", "disable the patch section and");
}

export function patchInstallHtml(release: Pick<Release, "serial" | "crc">): string {
  const filename: string = `${release.serial}_${release.crc}.pnach`;
  return `<ol><li>In PCSX2, choose <b>Tools &gt; Open Data Directory</b> and open <code>patches</code>.</li><li>Save this download there as <code>${esc(filename)}</code>. Portable example: <code>${esc(`<PCSX2 folder>\\patches\\${filename}`)}</code>.</li><li>Right-click the game, open <b>Properties &gt; Patches</b>, reload the list if needed, and enable the intended named patch sections and their required dependencies.</li><li>Start the game from a fresh boot. Follow this feature's setup, controls, conflicts and recovery instructions.</li></ol><p>Keep alternative modules separate. The ZIP is an archive of alternatives; do not enable everything together.</p>`;
}

export function patchInstallSummary(): string {
  return 'Selectable feature downloads go in <code>patches</code> and use <b>Properties &gt; Patches</b>. Legacy release cheat files use <code>cheats</code> and <b>Properties &gt; Cheats &gt; Enable Cheats</b>. <a href="/how-to/">Placement and setup</a>.';
}
