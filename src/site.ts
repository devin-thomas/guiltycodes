import type { start, stop } from "./bg.ts";
import { parseSearch } from "./search.ts";
import type { SearchEntry } from "./search.ts";

function requireElement<T extends Element>(selector: string, constructor: { new (...args: never[]): T }, root: ParentNode = document): T {
  let element: Element | null = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing or invalid page element: ${selector}`);
  return element;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character: string): string => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
function setupCopy(): void {
  for (let button of document.querySelectorAll<HTMLButtonElement>("button.copy")) button.dataset["label"] = button.textContent;
  document.addEventListener("click", (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    let button: Element | null = event.target.closest("button.copy");
    if (!(button instanceof HTMLButtonElement)) return;
    copyCode(button).catch((error: unknown): void => {
      console.error("Code copy failed", error);
      button.textContent = "Copy failed";
    });
  });
}
async function copyCode(button: HTMLButtonElement): Promise<void> {
  const target: string | undefined = button.dataset["target"];
  if (!target) throw new Error("Copy button has no target");
  let element: HTMLElement | null = document.getElementById(target);
  if (!element) throw new Error(`Missing copy target: ${target}`);
  const text: string = element.textContent.replace(/\n$/, "");
  try {
    let clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) selectCode(element, button);
    else {
      await clipboard.writeText(text);
      button.textContent = "Copied";
    }
  } catch (error: unknown) {
    if (!(error instanceof DOMException)) throw error;
    // Clipboard permission denial has an explicit manual-selection recovery path.
    console.warn("Clipboard unavailable; select and copy the code manually", error.name);
    selectCode(element, button);
  }
  setTimeout((): void => {
    button.textContent = button.dataset["label"] ?? "Copy";
  }, 1600);
}
function selectCode(element: HTMLElement, button: HTMLButtonElement): void {
  let range: Range = document.createRange();
  range.selectNodeContents(element);
  let selection: Selection | null = getSelection();
  if (!selection) throw new Error("Text selection unavailable");
  selection.removeAllRanges();
  selection.addRange(range);
  button.textContent = "Press Ctrl+C";
}

function setupFilter(): void {
  let table: HTMLElement | null = document.getElementById("codetable");
  if (!table) return;
  let input: HTMLInputElement = requireElement("#cf", HTMLInputElement);
  let chips: NodeListOf<HTMLButtonElement> = document.querySelectorAll<HTMLButtonElement>(".chip");
  let rows: NodeListOf<HTMLTableRowElement> = table.querySelectorAll<HTMLTableRowElement>("tr.code");
  let groups: NodeListOf<HTMLTableRowElement> = table.querySelectorAll<HTMLTableRowElement>("tr.grp");
  let shown: HTMLElement = requireElement("#shown", HTMLElement);
  function apply(): void {
    const terms: readonly string[] = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const enabled: ReadonlySet<string | undefined> = new Set(
      [...chips]
        .filter((chip: HTMLButtonElement): boolean => chip.getAttribute("aria-pressed") === "true")
        .map((chip: HTMLButtonElement): string | undefined => chip.dataset["status"]),
    );
    let count: number = 0;
    for (let row of rows) {
      const searchable: string | undefined = row.dataset["t"];
      if (searchable === undefined) throw new Error("Code row has no search text");
      const visible: boolean = enabled.has(row.dataset["s"]) && terms.every((term: string): boolean => searchable.includes(term));
      row.hidden = !visible;
      if (visible) count++;
    }
    for (let group of groups) {
      let sibling: Element | null = group.nextElementSibling;
      let visible: boolean = false;
      while (sibling && !sibling.classList.contains("grp")) {
        if (sibling instanceof HTMLElement && !sibling.hidden) visible = true;
        sibling = sibling.nextElementSibling;
      }
      group.hidden = !visible;
    }
    shown.textContent = count === rows.length ? "" : `${count} of ${rows.length}`;
  }
  input.addEventListener("input", apply);
  for (let chip of chips)
    chip.addEventListener("click", (): void => {
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
      apply();
    });
  const query: string | null = new URLSearchParams(location.search).get("q");
  if (query) {
    input.value = query;
    apply();
  }
}
async function setupSearch(): Promise<void> {
  let form: HTMLElement | null = document.getElementById("sform");
  if (!form) return;
  let input: HTMLInputElement = requireElement("#sq", HTMLInputElement);
  let output: HTMLTableElement = requireElement("#stable", HTMLTableElement);
  let tbody: HTMLTableSectionElement = requireElement("tbody", HTMLTableSectionElement, output);
  let note: HTMLElement = requireElement("#sres", HTMLElement);
  let data: readonly SearchEntry[] | null = null;
  function run(): void {
    const terms: readonly string[] = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!data || !terms.length) {
      output.hidden = true;
      note.textContent = "";
      return;
    }
    const hits: readonly SearchEntry[] = data.filter((entry: SearchEntry): boolean =>
      terms.every((term: string): boolean => entry.x.includes(term)),
    );
    output.hidden = !hits.length;
    note.textContent = hits.length
      ? `${hits.length} ${hits.length === 1 ? "code" : "codes"}${hits.length > 200 ? ", first 200 shown" : ""}`
      : "No codes match.";
    tbody.innerHTML = hits
      .slice(0, 200)
      .map(
        (entry: SearchEntry): string =>
          `<tr><td><a href="${escapeHtml(entry.u)}">${escapeHtml(entry.t)}</a></td><td>${escapeHtml(entry.g)} <small>${escapeHtml(entry.r)}</small></td><td><span class="st st-${entry.s.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(entry.s)}</span></td></tr>`,
      )
      .join("");
  }
  form.addEventListener("submit", (event: Event): void => {
    event.preventDefault();
    history.replaceState(null, "", `?q=${encodeURIComponent(input.value)}`);
    run();
  });
  input.addEventListener("input", run);
  try {
    const response: Response = await fetch("/search.json");
    if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
    const raw: unknown = await response.json();
    data = parseSearch(raw);
    const query: string | null = new URLSearchParams(location.search).get("q");
    if (query) input.value = query;
    run();
  } catch (error: unknown) {
    note.textContent = "Search could not load. Reload to try again.";
    throw error;
  }
}
function readBackgroundPreference(): boolean {
  try {
    return localStorage.getItem("gc-bg") !== "off";
  } catch (error: unknown) {
    if (!(error instanceof DOMException)) throw error;
    console.warn("Background preference storage unavailable", error.name);
    return true;
  }
}
function setupBackground(): void {
  let button: HTMLButtonElement = requireElement("#bgtoggle", HTMLButtonElement);
  let want: boolean = readBackgroundPreference();
  if (
    "connection" in navigator &&
    typeof navigator.connection === "object" &&
    navigator.connection !== null &&
    "saveData" in navigator.connection &&
    navigator.connection.saveData === true
  )
    want = false;
  let background: { readonly start: typeof start; readonly stop: typeof stop } | null = null;
  async function apply(): Promise<void> {
    button.textContent = `Background: ${want ? "on" : "off"}`;
    button.setAttribute("aria-pressed", String(want));
    document.documentElement.classList.toggle("bg-off", !want);
    if (want) {
      background ??= await import("./bg.ts");
      // A later click may have disabled the background while the import loaded.
      if (want) background.start("#bg");
    } else background?.stop();
  }
  function reportFailure(error: unknown): void {
    console.error("Background could not start", error);
    document.documentElement.classList.add("bg-off");
  }
  button.addEventListener("click", (): void => {
    want = !want;
    try {
      localStorage.setItem("gc-bg", want ? "on" : "off");
    } catch (error: unknown) {
      if (!(error instanceof DOMException)) throw error;
      console.warn("Background preference could not be saved", error.name);
    }
    apply().catch(reportFailure);
  });
  function boot(): void {
    apply().catch(reportFailure);
  }
  if (document.readyState === "complete") boot();
  else
    addEventListener("load", (): void => {
      setTimeout(boot, 50);
    });
}
let gamesList: Element | null = document.querySelector(".side details");
if (gamesList && innerWidth <= 860) gamesList.removeAttribute("open");
setupCopy();
setupFilter();
setupSearch().catch((error: unknown): void => {
  console.error("Search failed", error);
});
setupBackground();
