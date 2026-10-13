(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Collapse the games list on narrow screens
  const gl = $(".side details");
  if (gl && innerWidth <= 860) gl.removeAttribute("open");

  // Copy buttons
  for (const b of $$("button.copy")) b.dataset.label = b.textContent;
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button.copy");
    if (!b) return;
    const el = document.getElementById(b.dataset.target);
    if (!el) return;
    const text = el.textContent.replace(/\n$/, "");
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
    } catch {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      b.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (b.textContent = b.dataset.label), 1600);
  });

  // Filter on a release's code table
  const table = $("#codetable");
  if (table) {
    const input = $("#cf");
    const chips = $$(".chip");
    const rows = $$("tr.code", table);
    const shown = $("#shown");
    const apply = () => {
      const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const on = new Set(chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.status));
      let n = 0;
      for (const r of rows) {
        const ok = on.has(r.dataset.s) && q.every((t) => r.dataset.t.includes(t));
        r.hidden = !ok;
        if (ok) n++;
      }
      for (const g of $$("tr.grp", table)) {
        let el = g.nextElementSibling;
        let any = false;
        while (el && !el.classList.contains("grp")) {
          if (!el.hidden) any = true;
          el = el.nextElementSibling;
        }
        g.hidden = !any;
      }
      shown.textContent = n === rows.length ? "" : `${n} of ${rows.length}`;
    };
    input.addEventListener("input", apply);
    for (const c of chips)
      c.addEventListener("click", () => {
        c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true");
        apply();
      });
    const q = new URLSearchParams(location.search).get("q");
    if (q) {
      input.value = q;
      apply();
    }
  }

  // Search page
  const sform = $("#sform");
  if (sform) {
    const input = $("#sq");
    const out = $("#stable");
    const tbody = $("tbody", out);
    const note = $("#sres");
    let data = null;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const run = () => {
      const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!data || !terms.length) {
        out.hidden = true;
        note.textContent = "";
        return;
      }
      const hits = data.filter((d) => terms.every((t) => d.x.includes(t)));
      out.hidden = !hits.length;
      note.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? "code" : "codes"}${hits.length > 200 ? ", first 200 shown" : ""}` : "No codes match.";
      tbody.innerHTML = hits
        .slice(0, 200)
        .map((d) => `<tr><td><a href="${d.u}">${esc(d.t)}</a></td><td>${esc(d.g)} <small>${esc(d.r)}</small></td><td><span class="st st-${d.s.toLowerCase().replace(/\s+/g, "-")}">${esc(d.s)}</span></td></tr>`)
        .join("");
    };
    sform.addEventListener("submit", (e) => {
      e.preventDefault();
      history.replaceState(null, "", `?q=${encodeURIComponent(input.value)}`);
      run();
    });
    input.addEventListener("input", run);
    fetch("/search.json")
      .then((r) => r.json())
      .then((d) => {
        data = d;
        const q = new URLSearchParams(location.search).get("q");
        if (q) input.value = q;
        run();
      });
  }

  // Background
  const KEY = "gc-bg";
  const btn = $("#bgtoggle");
  let want = true;
  try {
    want = localStorage.getItem(KEY) !== "off";
  } catch {}
  if (navigator.connection?.saveData) want = false;
  let mod = null;
  const label = () => {
    btn.textContent = `Background: ${want ? "on" : "off"}`;
    btn.setAttribute("aria-pressed", String(want));
    document.documentElement.classList.toggle("bg-off", !want);
  };
  const apply = async () => {
    label();
    if (want) {
      try {
        mod ??= await import("/assets/bg.js");
        mod.start("#bg");
      } catch {
        document.documentElement.classList.add("bg-off");
      }
    } else mod?.stop();
  };
  btn?.addEventListener("click", () => {
    want = !want;
    try {
      localStorage.setItem(KEY, want ? "on" : "off");
    } catch {}
    apply();
  });
  const boot = () => apply();
  if (document.readyState === "complete") boot();
  else addEventListener("load", () => setTimeout(boot, 50));
})();
