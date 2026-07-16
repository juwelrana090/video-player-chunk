# Claude Code Prompt — Fix Folder Browsing + Auto-Next Video

> Paste this entire file into Claude Code.
> Read `index.html` and `index.js` fully before touching anything.

---

## BUGS BEING FIXED

| #   | Bug                                                               | Symptom                                                 |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `_lastFiles` missing from `const S`                               | dynamic property, causes undefined errors               |
| 2   | `quickPath()` only fills input, never scans                       | user must click Scan after Desktop/Downloads/Videos     |
| 3   | `#dirList` is a separate `max-h-48` scroll area above `#fileList` | two independent scroll areas, dirs push files down      |
| 4   | `renderDirs()` uses inline `onclick`                              | inconsistent with event delegation used everywhere else |
| 5   | No parent folder `← ..` navigation                                | once inside a subfolder, no way back                    |
| 6   | `ended` handler has no auto-next logic                            | video stops, nothing plays                              |
| 7   | No `autoplay` toggle                                              | can't turn auto-next on/off                             |

---

## STEP 0 — Read files first

```
Read index.html and index.js completely before making any change.
```

---

## CHANGE 1 — Fix `const S` state model

**FIND** this exact block:

```js
const S = {
  filePath: null,
  fileName: null,
  isDirect: false,
  info: null,
  duration: 0,
  audioIdx: 0,
  offset: 0,
  looping: false,
  showInfo: false,
  osdTimer: null,
  recentDirs: [],
  homePath: "",
  view: "list", // 'list' | 'grid'
  _lastDirs: [], // subdirs from last scan (for re-render)
};
```

**REPLACE WITH:**

```js
const S = {
  filePath: null,
  fileName: null,
  isDirect: false,
  info: null,
  duration: 0,
  audioIdx: 0,
  offset: 0,
  looping: false,
  showInfo: false,
  osdTimer: null,
  recentDirs: [],
  homePath: "",
  view: "list", // 'list' | 'grid'
  _lastDirs: [], // subdirs from last scan
  _lastFiles: null, // files from last scan
  autoplay: true, // auto-advance to next file when video ends
  currentDir: "", // currently browsed directory path
};
```

---

## CHANGE 2 — Remove `#dirList` HTML element

**FIND** this entire block in the HTML:

```html
<!-- SUBFOLDER LIST: shown above videos when dirs exist -->
<div
  id="dirList"
  style="display:none"
  class="border-b border-white/5 flex-shrink-0 max-h-48 overflow-y-auto p-1 space-y-0.5"
>
  <!-- rendered by renderDirs() -->
</div>
```

**DELETE it entirely.** Folders will be rendered inside `#fileList` going forward.

---

## CHANGE 3 — Add `⏭` autoplay button to HTML controls

**FIND** this exact button in the HTML controls:

```html
<button
  id="btnLoop"
  class="btn p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all"
>
  &#128257;
</button>
```

**REPLACE WITH** (add `btnAutoplay` right after `btnLoop`):

```html
<button
  id="btnLoop"
  class="btn p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all"
>
  &#128257;
</button>
<button
  id="btnAutoplay"
  title="Auto-next (N)"
  class="btn on p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all"
>
  &#9197;
</button>
```

> `&#9197;` is ⏭. Starting with `class="btn on"` because `S.autoplay` defaults to `true`.

---

## CHANGE 4 — Fix `quickPath()` to auto-scan

**FIND** this exact end of `quickPath()`:

```js
      if (!p) { showOSD('⚠️ Home path not loaded yet — try scanning manually'); return; }
      $('pathInput').value = p; $('pathInput').focus(); $('pathInput').select();
    }
```

**REPLACE WITH:**

```js
      if (!p) { showOSD('⚠️ Home path not loaded yet — try scanning manually'); return; }
      $('pathInput').value = p;
      scanFolder(p);  // ← auto-scan immediately on shortcut click
    }
```

---

## CHANGE 5 — Update `scanFolder()` to store `currentDir` and call `renderBrowser()`

**FIND** these lines inside `scanFolder()` (after the successful fetch):

```js
S.recentDirs = [...new Set([d.dir, ...S.recentDirs])].slice(0, 5);
localStorage.setItem("vlc_recent", JSON.stringify(S.recentDirs));
$("pathInput").value = d.dir;
st.textContent = `${d.files.length} video${d.files.length !== 1 ? "s" : ""} found`;
st.style.color = d.files.length > 0 ? "#4ade80" : "rgba(255,255,255,.3)";
const parts = d.dir.replace(/\\/g, "/").split("/").filter(Boolean);
$("folderBadge").textContent = parts[parts.length - 1] || d.dir;
$("folderBadge").style.display = "";
renderRecent();
S._lastDirs = d.dirs || [];
renderDirs(S._lastDirs);
renderFiles(d.files);
```

**REPLACE WITH:**

```js
S.recentDirs = [...new Set([d.dir, ...S.recentDirs])].slice(0, 5);
localStorage.setItem("vlc_recent", JSON.stringify(S.recentDirs));
$("pathInput").value = d.dir;
S.currentDir = d.dir;
st.textContent = `${d.files.length} video${d.files.length !== 1 ? "s" : ""} found`;
st.style.color = d.files.length > 0 ? "#4ade80" : "rgba(255,255,255,.3)";
const parts = d.dir.replace(/\\/g, "/").split("/").filter(Boolean);
$("folderBadge").textContent = parts[parts.length - 1] || d.dir;
$("folderBadge").style.display = "";
renderRecent();
S._lastDirs = d.dirs || [];
S._lastFiles = d.files || [];
renderBrowser(S._lastDirs, S._lastFiles);
```

---

## CHANGE 6 — Update event delegation to handle `[data-dir-path]`

**FIND** this exact block in `document.addEventListener('click', ...)`:

```js
// FIX 2+3: event delegation for file list AND recent list
document.addEventListener("click", (e) => {
  // Recent folder click
  const rd = e.target.closest(".recent-dir");
  if (rd) {
    const d = rd.dataset.dir;
    if (d) {
      $("pathInput").value = d;
      scanFolder(d);
    }
    return;
  }
  // File row click — but not delete button
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    return;
  }
  const row = e.target.closest("[data-path]");
  if (row && row.dataset.path && row.dataset.name)
    playFile(row.dataset.path, row.dataset.name);
});
```

**REPLACE WITH:**

```js
document.addEventListener("click", (e) => {
  // Recent folder click
  const rd = e.target.closest(".recent-dir");
  if (rd) {
    const d = rd.dataset.dir;
    if (d) {
      $("pathInput").value = d;
      scanFolder(d);
    }
    return;
  }
  // Subfolder row click — navigate into dir
  const dr = e.target.closest("[data-dir-path]");
  if (dr) {
    const dp = dr.dataset.dirPath;
    if (dp) {
      $("pathInput").value = dp;
      scanFolder(dp);
    }
    return;
  }
  // File row click — but not delete button
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    return;
  }
  const row = e.target.closest("[data-path]");
  if (row && row.dataset.path && row.dataset.name)
    playFile(row.dataset.path, row.dataset.name);
});
```

---

## CHANGE 7 — Add `parentDir()` helper and replace `renderDirs()` + `renderFiles()` with unified `renderBrowser()`

**DELETE** the entire existing `renderDirs()` function (from `/* ── renderDirs:` to its closing `}`).

**DELETE** the entire existing `renderFiles()` function (from `/* ── renderFiles:` to its closing `}`).

**ADD** these three functions in their place:

```js
/* ── parentDir: compute parent path cross-platform ───────────────────────── */
function parentDir(p) {
  const isWin = p.includes("\\") || /^[A-Za-z]:/.test(p);
  const sep = isWin ? "\\" : "/";
  const parts = p
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  if (parts.length <= 1) return null; // already at root
  parts.pop();
  const joined = parts.join(sep);
  return isWin ? joined : "/" + joined;
}

/* ── renderBrowser: unified dirs + files in #fileList ────────────────────── */
// Replaces the old separate renderDirs() + renderFiles().
// Renders: [← Parent] → [📁 Folders] → [── N videos ──] → [🎬 Files]
function renderBrowser(dirs, files) {
  const el = $("fileList");
  $("fileCount").textContent = files.length;

  const parent = parentDir(S.currentDir);
  let html = "";

  // ── Parent row ────────────────────────────────────────────────────────────
  if (parent) {
    html += `
    <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer
                hover:bg-vlc-srf2 transition-colors group border-b border-white/5 mb-1"
         data-dir-path="${escH(parent)}">
      <div class="w-[52px] h-[33px] bg-vlc-srf2 rounded flex-shrink-0
                  flex items-center justify-center text-base text-white/40">
        ↑
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium text-white/50 group-hover:text-white transition-colors">
          .. Parent folder
        </div>
        <div class="text-[10px] text-white/25 truncate">${escH(parent)}</div>
      </div>
    </div>`;
  }

  // ── Folder rows ───────────────────────────────────────────────────────────
  dirs.forEach((d) => {
    html += `
    <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer
                hover:bg-vlc-srf2 transition-colors group"
         data-dir-path="${escH(d.path)}">
      <div class="w-[52px] h-[33px] bg-vlc-srf2 rounded flex-shrink-0
                  flex items-center justify-center text-lg text-white/30">
        📁
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium text-white/70 truncate
                    group-hover:text-white transition-colors"
             title="${escH(d.name)}">${escH(d.name)}</div>
        <div class="text-[10px] text-white/25">Folder</div>
      </div>
      <span class="text-white/20 text-xs group-hover:text-white/50 flex-shrink-0">›</span>
    </div>`;
  });

  // ── Separator between folders and files ───────────────────────────────────
  if (dirs.length > 0 && files.length > 0) {
    html += `
    <div class="flex items-center gap-2 px-2 py-1 mt-1 mb-0.5">
      <div class="flex-1 h-px bg-white/5"></div>
      <span class="text-[9px] font-bold uppercase tracking-widest text-white/20">
        ${files.length} video${files.length !== 1 ? "s" : ""}
      </span>
      <div class="flex-1 h-px bg-white/5"></div>
    </div>`;
  }

  // ── File rows: list or grid ───────────────────────────────────────────────
  if (!files.length && !dirs.length && !parent) {
    el.innerHTML =
      '<div class="text-center py-10 text-white/20 text-xs leading-loose">No videos or folders found.<br>Try a different path.</div>';
    return;
  }

  if (S.view === "grid" && files.length > 0) {
    html +=
      `<div class="grid grid-cols-2 gap-1.5 p-1.5 mt-1">` +
      files
        .map((f) => {
          const ext = (f.name.split(".").pop() || "").toUpperCase();
          const act = S.filePath === f.path;
          return `
        <div class="file-grid-item relative rounded-lg overflow-hidden cursor-pointer
                    border-2 transition-all ${act ? "border-vlc-orange" : "border-transparent hover:border-white/10"}"
             data-path="${escH(f.path)}" data-name="${escH(f.name)}">
          <div class="w-full aspect-video bg-vlc-srf3 overflow-hidden">
            <img src="/thumb?path=${encodeURIComponent(f.path)}" alt=""
                 class="w-full h-full object-cover"
                 onerror="this.parentNode.innerHTML='<div class=\'w-full h-full flex items-center justify-center text-2xl\'>🎬</div>'">
          </div>
          <div class="px-1.5 py-1 bg-vlc-srf2">
            <div class="text-[10px] font-medium truncate ${act ? "text-vlc-orange2" : "text-white/80"}"
                 title="${escH(f.name)}">${escH(f.name)}</div>
            <div class="flex items-center gap-1 mt-0.5">
              <span class="text-[8px] font-bold uppercase px-1 py-px rounded bg-vlc-srf3 text-white/25">${escH(ext)}</span>
              <span class="text-[10px] text-white/25">${fmtSz(f.size)}</span>
            </div>
          </div>
          <div class="row-act opacity-0 transition-opacity absolute inset-0 flex items-center justify-center
                      bg-black/40 pointer-events-none">
            <span class="text-white text-2xl">▶</span>
          </div>
        </div>`;
        })
        .join("") +
      `</div>`;
  } else {
    html += files
      .map((f) => {
        const ext = (f.name.split(".").pop() || "").toUpperCase();
        const act = S.filePath === f.path;
        return `
      <div class="file-row flex items-center gap-2 px-2 py-1.5 cursor-pointer border-l-2 transition-colors
                  ${act ? "bg-vlc-orange/10 border-vlc-orange" : "hover:bg-vlc-srf2 border-transparent"}"
           data-path="${escH(f.path)}" data-name="${escH(f.name)}">
        <div class="w-[52px] h-[33px] bg-vlc-srf3 rounded flex-shrink-0 overflow-hidden flex items-center justify-center text-base">
          <img src="/thumb?path=${encodeURIComponent(f.path)}" alt=""
               class="w-full h-full object-cover"
               onerror="this.parentNode.innerHTML='🎬'">
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium truncate ${act ? "text-vlc-orange2" : "text-white"}"
               title="${escH(f.name)}">${escH(f.name)}</div>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-[9px] font-bold uppercase px-1 py-px rounded bg-vlc-srf3 text-white/25">${escH(ext)}</span>
            <span class="text-[11px] text-white/25">${fmtSz(f.size)}</span>
          </div>
        </div>
        <div class="row-act opacity-0 transition-opacity flex-shrink-0">
          <span class="text-[10px] px-2 py-1 rounded bg-vlc-orange/20 text-vlc-orange font-bold">▶</span>
        </div>
      </div>`;
      })
      .join("");
  }

  el.innerHTML = html;
}

/* ── setView: toggle between list and grid view ──────────────────────────── */
function setView(mode) {
  S.view = mode;
  const btnList = $("btnViewList");
  const btnGrid = $("btnViewGrid");
  btnList.className = `px-1.5 py-1 rounded text-sm transition-colors ${
    mode === "list"
      ? "text-vlc-orange bg-vlc-orange/10"
      : "text-white/30 hover:text-white hover:bg-white/10"
  }`;
  btnGrid.className = `px-1.5 py-1 rounded text-sm transition-colors ${
    mode === "grid"
      ? "text-vlc-orange bg-vlc-orange/10"
      : "text-white/30 hover:text-white hover:bg-white/10"
  }`;
  if (S._lastDirs !== undefined && S._lastFiles)
    renderBrowser(S._lastDirs, S._lastFiles);
}
```

---

## CHANGE 8 — Update `playFile()` to call `renderBrowser()`

**FIND** inside `playFile()`:

```js
// FIX 6: re-render the file list to update active state cleanly
if (S._lastDirs) renderDirs(S._lastDirs);
if (S._lastFiles) renderFiles(S._lastFiles);
```

**REPLACE WITH:**

```js
if (S._lastFiles) renderBrowser(S._lastDirs || [], S._lastFiles);
```

---

## CHANGE 9 — Add auto-next logic to `ended` handler

**FIND** the entire `ended` handler:

```js
vid.addEventListener("ended", () => {
  const t = actualTime(),
    nearEnd = S.duration - t < 2;
  if (!nearEnd && S.filePath && !S.isDirect) {
    loadStream(t);
    return;
  }
  if (S.looping && S.filePath) {
    loadStream(0);
    return;
  }
  $("btnPlay").textContent = "▶";
});
```

**REPLACE WITH:**

```js
vid.addEventListener("ended", () => {
  const t = actualTime(),
    nearEnd = S.duration - t < 2;

  // Premature end on transcoded stream — reload from current position
  if (!nearEnd && S.filePath && !S.isDirect) {
    loadStream(t);
    return;
  }

  // Loop current video
  if (S.looping && S.filePath) {
    loadStream(0);
    return;
  }

  // Auto-next: advance to next file in the scanned library
  if (S.autoplay && S._lastFiles && S._lastFiles.length > 0 && S.filePath) {
    const idx = S._lastFiles.findIndex((f) => f.path === S.filePath);
    if (idx !== -1 && idx + 1 < S._lastFiles.length) {
      const next = S._lastFiles[idx + 1];
      showOSD(`⏭ Next: ${next.name}`);
      playFile(next.path, next.name);
      return;
    }
  }

  $("btnPlay").textContent = "▶";
});
```

---

## CHANGE 10 — Wire up `btnAutoplay` click handler + keyboard shortcut

**FIND** this line:

```js
$("btnLoop").addEventListener("click", () => {
  S.looping = !S.looping;
  $("btnLoop").classList.toggle("on", S.looping);
  showOSD(S.looping ? "🔁 Loop ON" : "➡️ Loop OFF");
});
```

**REPLACE WITH** (add `btnAutoplay` handler on the next line):

```js
$("btnLoop").addEventListener("click", () => {
  S.looping = !S.looping;
  $("btnLoop").classList.toggle("on", S.looping);
  showOSD(S.looping ? "🔁 Loop ON" : "➡️ Loop OFF");
});
$("btnAutoplay").addEventListener("click", () => {
  S.autoplay = !S.autoplay;
  $("btnAutoplay").classList.toggle("on", S.autoplay);
  showOSD(S.autoplay ? "⏭ Auto-next ON" : "⏭ Auto-next OFF");
});
```

**FIND** this block in the keyboard handler:

```js
        case 'l': case 'L': $('btnLoop').click(); break;
```

**REPLACE WITH:**

```js
        case 'l': case 'L': $('btnLoop').click(); break;
        case 'n': case 'N': $('btnAutoplay').click(); break;
```

---

## CHANGE 11 — Verify init calls `renderBrowser` after auto-scan

Find the init block at the bottom. The `scanFolder(S.recentDirs[0])` call will now flow through the updated `scanFolder()` which calls `renderBrowser()` — **no change needed here**.

Also verify that the `navigateDir()` function is either removed (it was a wrapper around scanFolder) or kept as a no-op. Since all dir navigation now goes through `[data-dir-path]` in event delegation calling `scanFolder()` directly, **delete the old `navigateDir()` function entirely**.

---

## CHANGE 12 — Final: remove old `navigateDir()` function

**FIND** and **DELETE** this entire function:

```js
/* ── navigateDir: click a folder row to navigate into it ─────────────────── */
function navigateDir(folderPath) {
  $("pathInput").value = folderPath;
  scanFolder(folderPath);
}
```

---

## COMPLETE CHANGE SUMMARY

```
index.html  const S:
  + _lastFiles: null
  + autoplay: true
  + currentDir: ''

index.html  HTML sidebar:
  - <div id="dirList" ...>  ← REMOVED entirely

index.html  HTML controls:
  + <button id="btnAutoplay" ...>⏭</button>  (after btnLoop)

index.html  quickPath():
  + scanFolder(p)  ← auto-scan on shortcut click

index.html  scanFolder():
  + S.currentDir = d.dir
  + S._lastFiles = d.files || []
  - renderDirs(S._lastDirs); renderFiles(d.files);
  + renderBrowser(S._lastDirs, S._lastFiles);

index.html  event delegation:
  + [data-dir-path] check → scanFolder(dp)   (before [data-path] check)

index.html  functions DELETED:
  - renderDirs()
  - renderFiles()
  - navigateDir()

index.html  functions ADDED/UPDATED:
  + parentDir(p)              ← cross-platform parent path
  + renderBrowser(dirs,files) ← unified: [←] [📁 dirs] [── N videos ──] [files]
  + setView(mode)             ← updated to call renderBrowser

index.html  playFile():
  - renderDirs() + renderFiles()
  + renderBrowser(S._lastDirs || [], S._lastFiles)

index.html  ended handler:
  + auto-next block (after looping check)

index.html  event listeners:
  + btnAutoplay click → toggle S.autoplay
  + keyboard N/n → btnAutoplay.click()
```

---

## TEST CHECKLIST

```bash
node index.js   # → http://localhost:9090
```

1. Click **Desktop** shortcut → immediately scans (no separate Scan click needed)
2. Scan a folder with subfolders → `📁` dirs appear at top, then files below with `── N videos ──` separator
3. Click a folder → navigates into it, `← Parent folder` row appears at top
4. Click `← Parent folder` → navigates back up one level
5. Click `← Parent folder` again → goes further up until root (no parent row at root)
6. Play a video → finishes → **next video starts automatically**
7. OSD shows `⏭ Next: filename.mp4` when auto-advancing
8. Click **⏭** button → toggles to orange OFF state → video ends → nothing auto-plays
9. Click **⏭** again → back ON → auto-next resumes
10. Press **N** on keyboard → toggles autoplay
11. Grid view (⊞) → folders still show at top as list rows, videos show as grid cards below
12. List view (☰) → all rows uniform

```

```
