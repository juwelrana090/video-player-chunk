# Claude Code Prompt — Apply Fixed CHUNK_SIZE to video-player-chunk

> Paste this entire file into Claude Code. Read every existing file first, then implement.

---

## CONTEXT — What was wrong in the old server code

The old `index.js` had these four bugs that this update must **not** repeat:

| #   | Bug                                                               | Fix                                                                                                                                                                   |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `const videoPath = new url("test.mp4")`                           | `url` is not a valid constructor here — use a plain string: `const videoPath = "test.mp4"`                                                                            |
| 2   | `"Coontent_Type": "video/mp4"`                                    | Header typo — the Content-Type is silently never set. Must be `"Content-Type"`                                                                                        |
| 3   | No `return` after `res.status(400).send("Requires Range header")` | Without `return` execution continues, crashes with _"Cannot set headers after they are sent"_                                                                         |
| 4   | `const start = Number(range.replace(/\D/g, ""))`                  | Strips **all** non-digits — so `bytes=0-1048576` becomes `"01048576"` (garbled). Must parse only the start: `parseInt(range.replace(/bytes=/, '').split('-')[0], 10)` |

The **correct CHUNK_SIZE pattern** from the old code (after fixing all bugs above):

```js
const CHUNK_SIZE = 10 ** 6; // 1 MB — enforce fixed chunk size per request

const videoPath = path.join(__dirname, "test.mp4"); // plain path string ✓
const videoSize = fs.statSync(videoPath).size;

const range = req.headers.range;
if (!range) return res.status(400).send("Requires Range header"); // ← return ✓

const start = parseInt(range.replace(/bytes=/, "").split("-")[0], 10); // ← correct parse ✓
const end = Math.min(start + CHUNK_SIZE, videoSize - 1); // ← CHUNK_SIZE cap ✓
const contentLength = end - start + 1;

res.writeHead(206, {
  "Content-Range": `bytes ${start}-${end}/${videoSize}`,
  "Accept-Ranges": "bytes",
  "Content-Length": contentLength,
  "Content-Type": "video/mp4", // ← correct header name ✓
});

fs.createReadStream(videoPath, { start, end }).pipe(res);
```

---

## MISSION

Apply the fixed CHUNK_SIZE pattern into the **existing `video-player-chunk/index.js`**.

Three targeted changes only — do not rewrite anything else.

---

## STEP 0 — Read files first

```
Read these files before writing a single line of code:
  index.js
  package.json
```

Understand the existing `make1MBChunker()`, the `/stream` route, and its
`direct=1` vs `direct=0` branching before touching anything.

---

## STEP 1 — Add shared `CHUNK_SIZE` constant

**Location:** Top of `index.js`, after the last `require()` line and before `make1MBChunker()`.

**Add this line:**

```js
const CHUNK_SIZE = 10 ** 6; // 1 MB — fixed chunk size (matches original chunking logic)
```

---

## STEP 2 — Replace hardcoded value in `make1MBChunker()`

**Current code (inside `make1MBChunker`):**

```js
const CHUNK = 1024 * 1024; // 1 MB
```

**Replace with:**

```js
const CHUNK = CHUNK_SIZE; // use shared constant
```

> This keeps the ffmpeg transcode path (`direct=0`) and the direct serve path
> (`direct=1`) using the same chunk size definition.

---

## STEP 3 — Apply CHUNK_SIZE cap to the `direct=1` range serve block

This is the main fix. The current code serves **whatever range the browser
requests** — which can be the entire file in one shot. The old pattern enforces
a hard 1 MB cap so the browser makes sequential requests.

**Current code (inside the `if (direct) { ... if (range) { ... } }` block):**

```js
const [s, e] = range.replace(/bytes=/, "").split("-");
const start = parseInt(s, 10);
const end = e ? parseInt(e, 10) : fileSize - 1;
res.writeHead(206, {
  "Content-Range": `bytes ${start}-${end}/${fileSize}`,
  "Accept-Ranges": "bytes",
  "Content-Length": end - start + 1,
  "Content-Type": mime,
});
fs.createReadStream(fp, { start, end }).pipe(res);
```

**Replace with (applying the CHUNK_SIZE cap + correct parse):**

```js
const start = parseInt(range.replace(/bytes=/, "").split("-")[0], 10); // ← fixed parse
const end = Math.min(start + CHUNK_SIZE, fileSize - 1); // ← CHUNK_SIZE cap
res.writeHead(206, {
  "Content-Range": `bytes ${start}-${end}/${fileSize}`,
  "Accept-Ranges": "bytes",
  "Content-Length": end - start + 1,
  "Content-Type": mime,
});
fs.createReadStream(fp, { start, end }).pipe(res);
```

**Why this matters:**

- Old behaviour: browser asks for `bytes=0-` → server would send entire file
- New behaviour: browser asks for `bytes=0-` → server sends bytes `0–999999` → browser makes next request from `1000000` → and so on
- This is the classic HTTP range chunking pattern — prevents memory spikes on large files

---

## STEP 4 — Verify no other code is affected

After making the three changes, confirm:

1. The `direct=0` ffmpeg branch is **unchanged** — it still uses `make1MBChunker()`, which now references `CHUNK_SIZE`
2. The `else` block inside `if (direct)` (full-file serve when no `Range` header) is **unchanged**
3. No other routes reference `CHUNK_SIZE` — the scan/info/thumb routes are **unchanged**
4. `CHUNK_SIZE` is declared **once**, at module level, before `make1MBChunker()`

---

## STEP 5 — Final diff summary (exactly 3 changes)

```
index.js
  + const CHUNK_SIZE = 10 ** 6;          ← added after last require()

  make1MBChunker():
  - const CHUNK = 1024 * 1024;
  + const CHUNK = CHUNK_SIZE;             ← uses shared constant

  /stream → direct=1 → if (range) block:
  - const [s, e] = range.replace(/bytes=/, '').split('-');
  - const start  = parseInt(s, 10);
  - const end    = e ? parseInt(e, 10) : fileSize - 1;
  + const start = parseInt(range.replace(/bytes=/, '').split('-')[0], 10);
  + const end   = Math.min(start + CHUNK_SIZE, fileSize - 1);
```

---

## STEP 6 — Test

```bash
node index.js
# → http://localhost:9090
```

Open a video in the player with `direct=1` mode. In DevTools → Network tab,
confirm the video resource is fetched in multiple `206 Partial Content` responses,
each with a `Content-Range` spanning no more than `1,000,000` bytes.

# Claude Code Prompt — Video Folder Pic/Browser Options

> Paste this entire file into Claude Code. Read every existing file first, then implement.

---

## MISSION

Add three features to the existing `video-player-chunk` project:

1. **Green status text** — "N videos found" turns green after a successful scan (match screenshot)
2. **Subfolder navigation** — scan results show subdirectories; clicking one navigates into it
3. **Grid / List view toggle** — library can switch between compact list and large-thumbnail grid

---

## STEP 0 — Read files first

```
Read these files before writing a single line of code:
  index.js
  index.html
```

Understand the existing `/scan` route, `renderFiles()`, `S._lastFiles`, and
`S.recentDirs` before touching anything.

---

## STEP 1 — Update `/scan` in `index.js` to return subdirectories

**Current `/scan` route** returns only video files.

**Change:** Also return subdirectories in a `dirs` array.

Find the `app.post('/scan', ...)` block. Replace the `files` + `res.json` part only
(keep all existing validation logic at the top):

```js
// Directories (for folder navigation)
const allEntries = fs.readdirSync(dir);

const dirs = allEntries
  .filter((f) => !f.startsWith("."))
  .map((f) => {
    try {
      const full = path.join(dir, f);
      return fs.statSync(full).isDirectory() ? { name: f, path: full } : null;
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

const files = allEntries
  .filter(
    (f) => !f.startsWith(".") && VIDEO_EXTS.has(path.extname(f).toLowerCase()),
  )
  .map((f) => {
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    return { name: f, path: full, size: st.size, modified: st.mtime.getTime() };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

res.json({ dir, count: files.length, files, dirs });
```

---

## STEP 2 — Update state model in `index.html`

Find the `const S = { ... }` object. Add these two properties:

```js
view:      'list',   // 'list' | 'grid'
_lastDirs: [],       // subdirs from last scan (for re-render)
```

---

## STEP 3 — Add CSS for grid view in `<style>` block

Add inside the existing `<style>` tag, after the `.file-row:hover .row-act` rule:

```css
/* grid view thumbnail hover */
.file-grid-item:hover .row-act {
  opacity: 1;
}
```

---

## STEP 4 — Update `scanStatus` color to green on success

Find the `async function scanFolder(dir)` function.

Locate the line that sets the scan status text on success (after `renderFiles`).
Replace the status color logic so it shows green when files are found:

```js
st.textContent = `${d.files.length} video${d.files.length !== 1 ? "s" : ""} found`;
st.style.color = d.files.length > 0 ? "#4ade80" : "rgba(255,255,255,.3)";
```

Also store dirs and render them after renderFiles:

```js
S._lastDirs = d.dirs || [];
renderDirs(S._lastDirs);
renderFiles(d.files);
```

Make sure `renderDirs` is called BEFORE `renderFiles` so folders appear above videos.

---

## STEP 5 — Add `renderDirs()` function in `index.html`

Add this function directly **above** the existing `renderFiles()` function:

```js
/* ── renderDirs: show subdirectories above the file list ──────────────────── */
function renderDirs(dirs) {
  const el = $("dirList");
  if (!el) return; // guard: element may not exist yet
  if (!dirs || !dirs.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.innerHTML = dirs
    .map(
      (d) => `
    <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer
                hover:bg-vlc-srf2 transition-colors group"
         onclick="navigateDir('${escJs(d.path)}')">
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
    </div>
  `,
    )
    .join("");
}
```

Also add `navigateDir()` right after `renderDirs()`:

```js
/* ── navigateDir: click a folder row to navigate into it ─────────────────── */
function navigateDir(folderPath) {
  $("pathInput").value = folderPath;
  scanFolder(folderPath);
}
```

---

## STEP 6 — Update `renderFiles()` to support list and grid views

**Replace the entire existing `renderFiles()` function** with:

```js
/* ── renderFiles: list or grid view, driven by S.view ───────────────────── */
function renderFiles(files) {
  const el = $("fileList");
  $("fileCount").textContent = files.length;
  S._lastFiles = files;

  if (!files.length) {
    el.innerHTML =
      '<div class="text-center py-10 text-white/20 text-xs leading-loose">No video files found.<br>Try a different folder.</div>';
    return;
  }

  if (S.view === "grid") {
    // ── GRID VIEW: 2-column, large thumbnails ────────────────────────────
    el.innerHTML =
      `<div class="grid grid-cols-2 gap-1.5 p-1.5">` +
      files
        .map((f) => {
          const ext = (f.name.split(".").pop() || "").toUpperCase();
          const act = S.filePath === f.path;
          return `
        <div class="file-grid-item relative rounded-lg overflow-hidden cursor-pointer
                    border-2 transition-all ${act ? "border-vlc-orange" : "border-transparent hover:border-white/10"}"
             data-path="${escH(f.path)}" data-name="${escH(f.name)}">
          <!-- thumbnail -->
          <div class="w-full aspect-video bg-vlc-srf3 overflow-hidden">
            <img src="/thumb?path=${encodeURIComponent(f.path)}" alt=""
                 class="w-full h-full object-cover"
                 onerror="this.parentNode.innerHTML='<div class=\'w-full h-full flex items-center justify-center text-2xl\'>🎬</div>'">
          </div>
          <!-- filename overlay -->
          <div class="px-1.5 py-1 bg-vlc-srf2">
            <div class="text-[10px] font-medium truncate ${act ? "text-vlc-orange2" : "text-white/80"}"
                 title="${escH(f.name)}">${escH(f.name)}</div>
            <div class="flex items-center gap-1 mt-0.5">
              <span class="text-[8px] font-bold uppercase px-1 py-px rounded bg-vlc-srf3 text-white/25">${escH(ext)}</span>
              <span class="text-[10px] text-white/25">${fmtSz(f.size)}</span>
            </div>
          </div>
          <!-- play button overlay -->
          <div class="row-act opacity-0 transition-opacity absolute inset-0 flex items-center justify-center
                      bg-black/40 pointer-events-none">
            <span class="text-white text-2xl">▶</span>
          </div>
        </div>`;
        })
        .join("") +
      `</div>`;
  } else {
    // ── LIST VIEW: original compact rows ─────────────────────────────────
    el.innerHTML = files
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
}
```

---

## STEP 7 — Add view toggle buttons and `#dirList` to the HTML

### 7a — Add `#dirList` container

Find `<!-- FILE LIST: FIX 2 — uses event delegation ... -->` comment (just above `<div id="fileList"`).

**Insert this div directly before that comment:**

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

### 7b — Add view toggle to Library header

Find the `<!-- FILE LIST HEADER -->` div (contains `Library` text and `fileCount` badge).

**Replace that entire div with:**

```html
<!-- FILE LIST HEADER -->
<div
  class="flex items-center justify-between px-3 py-2 bg-vlc-bg2 border-b border-white/5 flex-shrink-0"
>
  <div class="flex items-center gap-2">
    <span class="text-[10px] font-bold uppercase tracking-widest text-white/30"
      >Library</span
    >
    <span
      id="fileCount"
      class="text-[11px] text-white/30 bg-vlc-srf2 px-2 py-0.5 rounded-full"
      >0</span
    >
  </div>
  <!-- View toggle: list / grid -->
  <div class="flex items-center gap-0.5">
    <button
      id="btnViewList"
      onclick="setView('list')"
      title="List view"
      class="px-1.5 py-1 rounded text-sm transition-colors text-vlc-orange bg-vlc-orange/10"
    >
      ☰
    </button>
    <button
      id="btnViewGrid"
      onclick="setView('grid')"
      title="Grid view"
      class="px-1.5 py-1 rounded text-sm transition-colors text-white/30 hover:text-white hover:bg-white/10"
    >
      ⊞
    </button>
  </div>
</div>
```

---

## STEP 8 — Add `setView()` function in `index.html`

Add this function directly **after** `navigateDir()`:

```js
/* ── setView: toggle between list and grid view ──────────────────────────── */
function setView(mode) {
  S.view = mode;
  const btnList = $("btnViewList");
  const btnGrid = $("btnViewGrid");

  // active state: orange highlight
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

  // re-render current file list in new view
  if (S._lastFiles) renderFiles(S._lastFiles);
}
```

---

## STEP 9 — Wire up grid-view click events

The existing click handler uses **event delegation** on `#fileList` — it already
checks for `data-path` / `data-name`. Verify it also works for grid items (it should,
since they use the same attributes). If the current delegation listener is:

```js
$("fileList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-path]");
  if (row && row.dataset.path && row.dataset.name)
    playFile(row.dataset.path, row.dataset.name);
});
```

No change needed — `e.target.closest('[data-path]')` already works for the grid cards.
If it does NOT use event delegation (uses inline `onclick`), replace it with the delegation pattern above.

---

## STEP 10 — Re-render dirs + files on `playFile()` active state update

The existing `playFile()` already calls `if (S._lastFiles) renderFiles(S._lastFiles)` to
update the active highlight. Add the same for dirs:

Find that line and change it to:

```js
if (S._lastDirs) renderDirs(S._lastDirs);
if (S._lastFiles) renderFiles(S._lastFiles);
```

---

## STEP 11 — Complete diff summary

```
index.js
  /scan POST route:
  + allEntries const
  + dirs array (subdirectories)
  + files uses allEntries
  + res.json includes dirs

index.html  <style>:
  + .file-grid-item:hover .row-act { opacity: 1 }

index.html  const S:
  + view: 'list'
  + _lastDirs: []

index.html  scanFolder():
  - st.textContent = '...'; st.style.color = '...';
  + green color when files.length > 0
  + S._lastDirs = d.dirs || []
  + renderDirs(S._lastDirs)

index.html  HTML before #fileList:
  + <div id="dirList" ...>  (subfolder container)

index.html  FILE LIST HEADER div:
  + view toggle buttons (☰ / ⊞)

index.html  functions added:
  + renderDirs(dirs)
  + navigateDir(folderPath)
  + setView(mode)

index.html  renderFiles():
  - single list-only render
  + if (S.view === 'grid') → 2-column grid with aspect-video thumbnails
  + else → original list rows (unchanged)

index.html  playFile():
  + if (S._lastDirs) renderDirs(S._lastDirs);
```

---

## STEP 12 — Test

```bash
node index.js
# → http://localhost:9090
```

**Test checklist:**

1. Scan a folder with mixed videos + subdirs → dirs appear above files with 📁 icon
2. Click a subfolder → `pathInput` updates, re-scans, new results appear
3. Status text shows green "N videos found" after scan
4. Click ⊞ (grid) → file list switches to 2-column thumbnail grid
5. Click ☰ (list) → switches back to compact list
6. Click a video in grid view → plays; active card gets orange border
7. Grid active state persists after track switch (orange border moves to playing item)
8. Folders with no subdirs → `#dirList` is hidden (`display:none`)
