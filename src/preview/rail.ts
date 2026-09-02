/**
 * The composition rail: the list on the left of both preview pages, and the
 * one place its markup, style and behaviour are written.
 *
 * A host previews one composition at a time — the CLI names it and, until
 * this, the process lived and died on that choice. The rail is how a person
 * picks another one; `POST /select` is what actually swaps the session.
 *
 * Rows are keyed by PATH. Two pairs in this tree share a compositionId —
 * `compositions/malicious` with `compositions/smoke`, and
 * `compositions/nested/a/9x16` with `compositions/nested/b/9x16` — so a
 * rail keyed by id would offer one row for two different films, which is the
 * shape of the mixup `src/cli/resolve.ts` already had to fix once for dist
 * directories.
 */

export function railStyles(): string {
  return `
  .shell {
    height: 100%;
    display: flex;
    min-width: 0;
    overflow: hidden;
  }
  .rail {
    flex: 0 0 210px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #0a0a0a;
    border-right: 1px solid #1c1c1c;
    overflow: hidden;
  }
  .rail-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 6px 7px 10px;
    border-bottom: 1px solid #1c1c1c;
    color: #7a7670;
  }
  .rail-head button, .rail-tab {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: #7a7670;
    cursor: pointer;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
  }
  .rail-head button:hover, .rail-tab:hover { color: #e8e4dc; }
  .rail-head svg, .rail-tab svg { width: 9px; height: 9px; display: block; }
  .rail-tab {
    display: none;
    flex: 0 0 18px;
    width: 18px;
    height: 100%;
    align-items: start;
    padding-top: 8px;
    background: #0a0a0a;
    border-right: 1px solid #1c1c1c;
  }
  .shell.rail-off .rail { display: none; }
  .shell.rail-off .rail-tab { display: grid; }
  .rail-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 4px 0;
    list-style: none;
  }
  .rail-list button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 3px 10px;
    background: none;
    border: 0;
    font: inherit;
    color: #b4b0a8;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rail-list button:hover { background: #141414; color: #e8e4dc; }
  .rail-list li.is-current button { background: #1c1c1c; color: #e8e4dc; }
  .rail-list button:disabled { color: #4a4640; cursor: default; background: none; }
  .rail-list .note { color: #6a655e; }
  .rail-msg { padding: 8px 10px; color: #f0c2b0; }
  .rail-list button:focus-visible, .rail-head button:focus-visible,
  .rail-tab:focus-visible {
    outline: 1px solid #e8e4dc;
    outline-offset: -2px;
  }`;
}

/** Opens the shell; the page's own `.app` goes after this and closes it. */
export function railMarkup(): string {
  return `<div class="shell" id="shell">
    <button class="rail-tab" id="rail-show" type="button" aria-label="Show compositions">
      <svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M2 0.5v8l5-4z"/></svg>
    </button>
    <nav class="rail" id="rail" aria-label="Compositions">
      <div class="rail-head">
        <span>compositions</span>
        <button id="rail-hide" type="button" aria-label="Hide compositions">
          <svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M7 0.5v8l-5-4z"/></svg>
        </button>
      </div>
      <ul class="rail-list" id="rail-list"></ul>
    </nav>`;
}

/**
 * The rail's own module. It is a second script rather than part of each
 * page's: a composition that fails to render still gets a rail to pick
 * another one from.
 */
export function railScript(): string {
  return `<script type="module">
  const shell = document.getElementById("shell");
  const list = document.getElementById("rail-list");
  const KEY = "pocket-motion:rail";

  function setRail(off) {
    shell.classList.toggle("rail-off", off);
    try { localStorage.setItem(KEY, off ? "off" : "on"); } catch {}
  }
  try { if (localStorage.getItem(KEY) === "off") shell.classList.add("rail-off"); } catch {}
  document.getElementById("rail-hide").addEventListener("click", () => setRail(true));
  document.getElementById("rail-show").addEventListener("click", () => setRail(false));

  function fail(message) {
    list.replaceChildren();
    const li = document.createElement("li");
    li.className = "rail-msg";
    li.textContent = message;
    list.append(li);
  }

  let cat;
  try {
    cat = await (await fetch("/compositions")).json();
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (!cat.ok) { fail(cat.error || "cannot list compositions"); }
  else {
    for (const item of cat.items) {
      const li = document.createElement("li");
      if (item.path === cat.current) li.className = "is-current";
      const b = document.createElement("button");
      b.type = "button";
      // The path is what identifies a composition here; the id is not
      // unique in this tree, so it rides along as the tooltip.
      b.textContent = item.path.replace(/^compositions\\//, "");
      b.title = item.path + (item.id ? " — " + item.id : "");
      if (!item.ready) {
        b.disabled = true;
        const note = document.createElement("span");
        note.className = "note";
        note.textContent = "  " + item.note;
        b.append(note);
        b.title += " — " + item.note;
      } else if (item.path !== cat.current) {
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            const res = await fetch("/select", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path: item.path }),
            });
            const body = await res.json();
            if (!body.ok) { fail(body.error || "select failed"); b.disabled = false; return; }
            location.reload();
          } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
            b.disabled = false;
          }
        });
      }
      li.append(b);
      list.append(li);
    }
  }
</script>`;
}
