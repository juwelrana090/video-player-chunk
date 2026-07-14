# Claude Code Prompt — VLC Player v3

## Tailwind CSS + Updated Packages + Playlist + Local PC File Browser

> Paste this entire file into Claude Code. Read every existing file first, then implement.

---

## MISSION

Upgrade the existing `video-player` Node.js project with:

1. **Tailwind CSS** — replace all raw CSS with Tailwind utility classes (CDN setup, no build step)
2. **Updated packages** — bump every dependency to its latest stable version
3. **Playlist system** — a collapsible bottom panel with queue management (add, remove, reorder, shuffle, repeat)
4. **Local PC file browser** — browse any folder on the local machine and add videos to the library/playlist without uploading them

---

## STEP 0 — Read first

```
Read these files before writing a single line of code:
- package.json
- index.js
- index.html
```

Understand the existing routes, state model, and `streamOffset` / `actualTime()` pattern before modifying anything.

---

## STEP 1 — Update `package.json`

Replace entirely with:

```json
{
  "name": "vlc-video-player",
  "version": "3.0.0",
  "description": "VLC-style video player — Tailwind CSS, playlist, local file browser",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "express": "^5.1.0",
    "multer": "^1.4.5-lts.1",
    "fluent-ffmpeg": "^2.1.3",
    "ffmpeg-static": "^5.2.0",
    "@ffprobe-installer/ffprobe": "^1.4.1",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.1.9"
  }
}
```

Run `npm install` after writing this.

---

## STEP 2 — Update `index.js`

Keep all existing routes. Add these new routes below the existing ones:

### New: `POST /browse` — scan a local folder for video files

```js
// POST /browse
// body: { dir: "C:/Users/Juwel/Videos" }
// returns: [{ name, path, size, modified }]
app.post("/browse", express.json(), (req, res) => {
  const dir = req.body?.dir;
  if (!dir) return res.status(400).json({ error: "dir is required" });

  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return res.status(404).json({ error: "Directory not found" });
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return VIDEO_EXTS.has(ext) && !f.startsWith(".");
      })
      .map((f) => {
        const fullPath = path.join(dir, f);
        const st = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath, // absolute path on disk
          size: st.size,
          modified: st.mtime.getTime(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ dir, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### New: `GET /local-info` — ffprobe a local path (no upload needed)

```js
// GET /local-info?path=C:/Videos/movie.mkv
app.get("/local-info", (req, res) => {
  const fp = req.query.path;
  if (!fp) return res.status(400).json({ error: "path is required" });
  if (!fs.existsSync(fp))
    return res.status(404).json({ error: "File not found" });

  ffmpeg.ffprobe(fp, (err, meta) => {
    if (err) return res.status(500).json({ error: err.message });
    // return same shape as /info/:name
    const audio = meta.streams
      .filter((s) => s.codec_type === "audio")
      .map((s, i) => {
        const lang = s.tags?.language,
          title = s.tags?.title;
        return {
          index: i,
          codec: s.codec_name,
          channels: s.channels,
          channelLayout: s.channel_layout || "",
          sampleRate: parseInt(s.sample_rate) || 0,
          language: lang || "und",
          title: title || null,
          label:
            title ||
            (lang && lang !== "und" ? lang.toUpperCase() : `Track ${i + 1}`),
          isDefault: s.disposition?.default === 1,
        };
      });
    const video = meta.streams
      .filter((s) => s.codec_type === "video")
      .map((s) => {
        let fps = 0;
        try {
          const [n, d] = s.r_frame_rate.split("/");
          fps = parseFloat(n) / parseFloat(d);
        } catch {}
        return {
          codec: s.codec_name,
          width: s.width,
          height: s.height,
          fps: Math.round(fps * 100) / 100,
          bitrate: parseInt(s.bit_rate) || 0,
          pixelFormat: s.pix_fmt,
        };
      });
    const subtitles = meta.streams
      .filter((s) => s.codec_type === "subtitle")
      .map((s, i) => ({
        index: i,
        codec: s.codec_name,
        language: s.tags?.language || "und",
        label:
          s.tags?.title ||
          (s.tags?.language && s.tags.language !== "und"
            ? s.tags.language.toUpperCase()
            : `Sub ${i + 1}`),
      }));
    const st = fs.statSync(fp);
    res.json({
      format: {
        name: meta.format.format_long_name || meta.format.format_name,
        duration: parseFloat(meta.format.duration) || 0,
        size: st.size,
        bitrate: parseInt(meta.format.bit_rate) || 0,
        title: meta.format.tags?.title || null,
      },
      video,
      audio,
      subtitles,
    });
  });
});
```

### New: `GET /local-thumb` — thumbnail from a local path

```js
// GET /local-thumb?path=C:/Videos/movie.mkv
app.get("/local-thumb", (req, res) => {
  const fp = req.query.path;
  if (!fp || !fs.existsSync(fp)) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  ffmpeg(fp)
    .setStartTime(4)
    .frames(1)
    .size("320x?")
    .videoCodec("mjpeg")
    .format("image2")
    .outputOptions(["-q:v", "5"])
    .on("error", () => res.status(500).end())
    .pipe(res, { end: true });
});
```

### New: `GET /local-stream` — stream a local file (same as /stream but source = local path)

```js
// GET /local-stream?path=C:/Videos/movie.mkv&audio=0&start=0
app.get("/local-stream", (req, res) => {
  const fp = req.query.path;
  if (!fp || !fs.existsSync(fp)) return res.status(404).end();

  const audioIdx = Math.max(-1, parseInt(req.query.audio ?? "0", 10));
  const startSec = Math.max(0, parseFloat(req.query.start ?? "0"));
  const sid = ++streamSeq;

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");

  const cmd = ffmpeg(fp)
    .setStartTime(startSec)
    .addOption("-map", "0:v:0")
    .videoCodec("libx264")
    .addOption("-preset", "ultrafast")
    .addOption("-tune", "zerolatency")
    .outputOptions(["-movflags", "frag_keyframe+empty_moov+default_base_moof"]);

  if (audioIdx >= 0) {
    cmd
      .addOption("-map", `0:a:${audioIdx}`)
      .audioCodec("aac")
      .addOption("-b:a", "192k")
      .addOption("-ac", "2");
  } else {
    cmd.noAudio();
  }

  cmd
    .format("mp4")
    .on("start", (cl) => console.log(`[local #${sid}] ${cl.slice(0, 160)}`))
    .on("error", (err) => {
      if (err.message?.includes("SIGKILL")) return;
      if (!res.headersSent) res.status(500).end();
      else res.end();
      activeStreams.delete(sid);
    })
    .on("end", () => activeStreams.delete(sid));

  activeStreams.set(sid, cmd);
  req.on("close", () => {
    try {
      cmd.kill("SIGKILL");
    } catch {}
    activeStreams.delete(sid);
  });
  cmd.pipe(res, { end: true });
});
```

---

## STEP 3 — Rewrite `index.html`

Complete rewrite using **Tailwind CSS CDN**. No raw CSS blocks except for 3 specific things that Tailwind can't handle:

1. The seek bar thumb hover trick
2. Custom scrollbar styling
3. The spinner animation

### Tailwind CDN Setup (inside `<head>`)

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          vlc: {
            bg: "#0d0d0f",
            bg2: "#141417",
            srf: "#1a1a1e",
            srf2: "#252529",
            srf3: "#333338",
            orange: "#ff6a00",
            orange2: "#ff8a1e",
            danger: "#ff4538",
          },
        },
        fontFamily: {
          sans: [
            "-apple-system",
            "BlinkMacSystemFont",
            "Segoe UI",
            "Roboto",
            "sans-serif",
          ],
        },
      },
    },
  };
</script>

<style>
  /* Only 3 things Tailwind can't do cleanly */

  /* Custom scrollbar */
  .custom-scroll::-webkit-scrollbar {
    width: 3px;
  }
  .custom-scroll::-webkit-scrollbar-thumb {
    background: #333338;
    border-radius: 2px;
  }

  /* Seek dot — appears only on parent hover */
  .seek-container:hover .seek-dot {
    opacity: 1;
  }
  .seek-container:hover .seek-bar {
    height: 6px;
  }

  /* Spinner */
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .spin {
    animation: spin 0.75s linear infinite;
  }

  /* Flash animation */
  @keyframes flashOut {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .flash-go {
    animation: flashOut 0.45s ease-out forwards;
  }

  /* Range input */
  input[type="range"] {
    -webkit-appearance: none;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 2px;
    height: 4px;
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 11px;
    height: 11px;
    background: #fff;
    border-radius: 50%;
    cursor: pointer;
  }
  input[type="range"]::-moz-range-thumb {
    width: 11px;
    height: 11px;
    background: #fff;
    border-radius: 50%;
    border: none;
  }
</style>
```

---

## STEP 4 — Full HTML Structure

### Overall Layout

```
body  flex flex-col h-screen overflow-hidden bg-vlc-bg text-white text-[13px] select-none

  ┌── TOPBAR ──────────────────────────────────────────────────────────────────┐
  │ h-11 bg-vlc-srf border-b border-white/5                                    │
  │ [▶ VLC badge] [title] [now-playing text flex-1] [format pill]              │
  └────────────────────────────────────────────────────────────────────────────┘

  ┌── LAYOUT  flex flex-1 min-h-0 ─────────────────────────────────────────────┐
  │                                                                              │
  │  ┌── LEFT SIDEBAR w-[272px] ──────┐  ┌── VIDEO MAIN flex-1 ──────────────┐ │
  │  │ bg-vlc-srf border-r            │  │ bg-black flex flex-col             │ │
  │  │                                │  │                                    │ │
  │  │ ┌─ TABS ──────────────────┐    │  │ ┌─ VIDEO WRAP flex-1 ───────────┐  │ │
  │  │ │ [Library] [Browse PC]   │    │  │ │ relative, centered            │  │ │
  │  │ └─────────────────────────┘    │  │ │ <video>                       │  │ │
  │  │                                │  │ │ placeholder overlay            │  │ │
  │  │ ┌─ TAB: LIBRARY ──────────┐    │  │ │ loading overlay                │  │ │
  │  │ │ Drop zone (upload)      │    │  │ │ play-flash overlay             │  │ │
  │  │ │ File list               │    │  │ │ OSD (top-right)               │  │ │
  │  │ │ each item:              │    │  │ │ Media info panel (bottom-right)│  │ │
  │  │ │   thumb + name + ext    │    │  │ └───────────────────────────────┘  │ │
  │  │ │   [+ playlist] [delete] │    │  │                                    │ │
  │  │ └─────────────────────────┘    │  │ ┌─ CONTROLS ───────────────────┐   │ │
  │  │                                │  │ │ Seek bar                      │   │ │
  │  │ ┌─ TAB: BROWSE PC ────────┐    │  │ │ Button row                    │   │ │
  │  │ │ Path input + [Browse]   │    │  │ └───────────────────────────────┘   │ │
  │  │ │ File list from folder   │    │  └────────────────────────────────────┘ │
  │  │ │ each item:              │    │                                          │
  │  │ │   thumb + name + ext    │    │                                          │
  │  │ │   [▶ play] [+ playlist] │    │                                          │
  │  │ └─────────────────────────┘    │                                          │
  │  └────────────────────────────────┘                                          │
  └──────────────────────────────────────────────────────────────────────────────┘

  ┌── PLAYLIST PANEL (collapsible bottom) ─────────────────────────────────────┐
  │ bg-vlc-srf border-t border-white/5                                          │
  │ COLLAPSED: h-9  → just header bar                                           │
  │ EXPANDED:  h-48 → header + scrollable list                                  │
  │                                                                              │
  │ Header: [▶ PLAYLIST (3)] [▶ Prev] [⏭ Next] [🔀 Shuffle] [🔁 Repeat] [🗑 Clear] [∧/∨] │
  │                                                                              │
  │ List (when expanded):                                                        │
  │   ► 1. movie.mkv             2:15  [✕]   ← currently playing (orange)      │
  │     2. episode.mp4          45:00  [✕]                                       │
  │     3. documentary.avi    1:20:00  [✕]                                       │
  └────────────────────────────────────────────────────────────────────────────┘
```

---

## STEP 5 — JavaScript State Model

### Extended state object:

```js
const S = {
  // Player
  file: null, // current filename OR null
  filePath: null, // absolute local path OR null (for /local-stream)
  isLocal: false, // true = file is from PC browse (use /local-* routes)
  info: null, // /info or /local-info response
  duration: 0,
  audioIdx: 0,
  offset: 0, // stream start time — CRITICAL for actualTime()
  looping: false,
  showInfo: false,
  osdTimer: null,

  // Playlist
  playlist: [], // [{ id, name, path, isLocal, duration, thumb }]
  plIndex: -1, // currently playing index in playlist (-1 = not in playlist)
  shuffle: false,
  repeat: "off", // 'off' | 'one' | 'all'
  plOpen: true, // playlist panel expanded

  // Browse PC
  browseDir: "", // last browsed directory path
  browseFiles: [], // files returned from /browse
};
```

### Playlist item schema:

```js
{
  id     : crypto.randomUUID(),  // unique id
  name   : 'movie.mkv',          // display name
  path   : 'C:/Videos/movie.mkv', // full path (for local) OR just name (for uploads)
  isLocal: true,                  // true = use /local-* routes
  duration: 7320,                 // seconds (0 if not yet probed)
}
```

---

## STEP 6 — Playlist System Logic

### Add to playlist

Every file in both the Library tab and Browse PC tab has a `[+ Add]` button.
When clicked:

```js
function addToPlaylist(name, path, isLocal) {
  // Check if already in playlist
  if (S.playlist.find((p) => p.path === path)) {
    showOSD("Already in playlist");
    return;
  }
  const item = { id: crypto.randomUUID(), name, path, isLocal, duration: 0 };
  S.playlist.push(item);
  renderPlaylist();
  showOSD(`➕ Added: ${name}`);

  // Probe duration in background
  const infoUrl = isLocal
    ? `/local-info?path=${encodeURIComponent(path)}`
    : `/info/${encodeURIComponent(name)}`;
  fetch(infoUrl)
    .then((r) => r.json())
    .then((info) => {
      item.duration = info.format?.duration || 0;
      renderPlaylist();
    })
    .catch(() => {});
}
```

### Play from playlist

```js
function playFromPlaylist(index) {
  if (index < 0 || index >= S.playlist.length) return;
  S.plIndex = index;
  const item = S.playlist[index];
  renderPlaylist(); // update active indicator

  if (item.isLocal) {
    playLocalFile(item.path, item.name);
  } else {
    playFile(item.name);
  }
}
```

### Auto-advance when video ends

```js
vid.addEventListener("ended", () => {
  const t = actualTime(),
    nearEnd = S.duration - t < 2;
  if (!nearEnd && S.file) {
    loadStream(t);
    return;
  } // premature end

  if (S.repeat === "one") {
    loadStream(0);
    return;
  }

  if (S.plIndex >= 0) {
    // advance playlist
    let next;
    if (S.shuffle) {
      next = Math.floor(Math.random() * S.playlist.length);
    } else {
      next = S.plIndex + 1;
      if (next >= S.playlist.length) {
        if (S.repeat === "all") next = 0;
        else {
          btnPlay.textContent = "▶";
          return;
        }
      }
    }
    playFromPlaylist(next);
    return;
  }

  if (S.looping) {
    loadStream(0);
    return;
  }
  btnPlay.textContent = "▶";
});
```

### Remove from playlist

```js
function removeFromPlaylist(id) {
  const idx = S.playlist.findIndex((p) => p.id === id);
  if (idx === -1) return;
  S.playlist.splice(idx, 1);
  if (S.plIndex === idx) S.plIndex = -1;
  else if (S.plIndex > idx) S.plIndex--;
  renderPlaylist();
}
```

### Clear playlist

```js
function clearPlaylist() {
  S.playlist = [];
  S.plIndex = -1;
  renderPlaylist();
  showOSD("🗑️ Playlist cleared");
}
```

### Render playlist

```js
function renderPlaylist() {
  const container = document.getElementById("plList");
  if (!S.playlist.length) {
    container.innerHTML = `
      <div class="text-center py-4 text-vlc-srf3 text-xs">
        No items. Add videos using the [+] button.
      </div>`;
    return;
  }
  container.innerHTML = S.playlist
    .map((item, i) => {
      const active = i === S.plIndex;
      const dur = item.duration ? fmt(item.duration) : "—:——";
      const bgClass = active
        ? "bg-vlc-orange/10 border-l-2 border-vlc-orange"
        : "hover:bg-vlc-srf2";
      return `
      <div class="flex items-center gap-2 px-3 py-2 cursor-pointer ${bgClass} group"
           data-plid="${item.id}" onclick="playFromPlaylist(${i})">
        <span class="text-xs w-5 text-center ${active ? "text-vlc-orange" : "text-vlc-srf3"}">
          ${active ? "▶" : i + 1}
        </span>
        <span class="flex-1 truncate text-xs ${active ? "text-vlc-orange2 font-medium" : "text-white/80"}"
              title="${escH(item.name)}">${escH(item.name)}</span>
        <span class="text-xs text-vlc-srf3 tabular-nums">${dur}</span>
        <button onclick="event.stopPropagation(); removeFromPlaylist('${item.id}')"
                class="opacity-0 group-hover:opacity-100 text-vlc-srf3 hover:text-vlc-danger px-1 text-xs">✕</button>
      </div>`;
    })
    .join("");

  // Update count badge
  document.getElementById("plCount").textContent = S.playlist.length;
}
```

---

## STEP 7 — Local PC Browser Logic

### UI (Browse PC tab)

```html
<!-- Inside Browse PC tab -->
<div class="p-3 space-y-2">
  <div class="flex gap-2">
    <input
      id="dirInput"
      type="text"
      placeholder="C:\Users\Juwel\Videos"
      class="flex-1 bg-vlc-srf2 border border-white/10 rounded-lg px-3 py-2 text-xs text-white
             placeholder-vlc-srf3 outline-none focus:border-vlc-orange/50"
    />
    <button
      onclick="browseDir()"
      id="btnBrowse"
      class="px-3 py-2 bg-vlc-orange rounded-lg text-xs font-semibold text-white hover:bg-vlc-orange2
             transition-colors whitespace-nowrap"
    >
      Scan
    </button>
  </div>

  <!-- Quick path shortcuts -->
  <div class="flex flex-wrap gap-1">
    <button
      onclick="quickPath('desktop')"
      class="px-2 py-1 bg-vlc-srf2 rounded text-[10px] text-vlc-srf3 hover:text-white hover:bg-vlc-srf3 transition-colors"
    >
      Desktop
    </button>
    <button
      onclick="quickPath('downloads')"
      class="px-2 py-1 bg-vlc-srf2 rounded text-[10px] text-vlc-srf3 hover:text-white hover:bg-vlc-srf3 transition-colors"
    >
      Downloads
    </button>
    <button
      onclick="quickPath('videos')"
      class="px-2 py-1 bg-vlc-srf2 rounded text-[10px] text-vlc-srf3 hover:text-white hover:bg-vlc-srf3 transition-colors"
    >
      Videos
    </button>
  </div>

  <div id="browseStatus" class="text-[11px] text-vlc-srf3 text-center hidden">
    Scanning…
  </div>
  <div id="browseList" class="space-y-0.5"></div>
</div>
```

### Browse logic

```js
async function browseDir() {
  const dir = document.getElementById("dirInput").value.trim();
  if (!dir) return showOSD("Enter a folder path");

  document.getElementById("browseStatus").classList.remove("hidden");
  document.getElementById("browseStatus").textContent = "Scanning…";
  document.getElementById("browseList").innerHTML = "";

  try {
    const r = await fetch("/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Failed");

    S.browseDir = data.dir;
    S.browseFiles = data.files;

    document.getElementById("browseStatus").textContent =
      `${data.files.length} video${data.files.length !== 1 ? "s" : ""} found`;

    renderBrowseList(data.files);
  } catch (err) {
    document.getElementById("browseStatus").textContent = "❌ " + err.message;
  }
}

function renderBrowseList(files) {
  const container = document.getElementById("browseList");
  if (!files.length) {
    container.innerHTML =
      '<div class="text-center py-4 text-vlc-srf3 text-xs">No video files found</div>';
    return;
  }
  container.innerHTML = files
    .map((f) => {
      const ext = (f.name.split(".").pop() || "").toUpperCase();
      return `
      <div class="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-vlc-srf2 group cursor-pointer"
           onclick="playLocalFile('${escJs(f.path)}', '${escJs(f.name)}')">
        <div class="w-[50px] h-[32px] rounded bg-vlc-srf3 flex-shrink-0 overflow-hidden flex items-center justify-center text-base">
          <img src="/local-thumb?path=${encodeURIComponent(f.path)}" alt=""
               class="w-full h-full object-cover"
               onerror="this.parentNode.innerHTML='🎬'">
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium text-white truncate" title="${escH(f.name)}">${escH(f.name)}</div>
          <div class="flex items-center gap-1 mt-0.5">
            <span class="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-vlc-srf3 text-vlc-srf3">${escH(ext)}</span>
            <span class="text-[11px] text-vlc-srf3">${fmtSz(f.size)}</span>
          </div>
        </div>
        <button onclick="event.stopPropagation(); addToPlaylist('${escJs(f.name)}', '${escJs(f.path)}', true)"
                class="opacity-0 group-hover:opacity-100 px-2 py-1 rounded bg-vlc-orange/20 text-vlc-orange text-[10px] font-bold hover:bg-vlc-orange hover:text-white transition-all whitespace-nowrap">
          + List
        </button>
      </div>`;
    })
    .join("");
}

// Quick path shortcuts — detect OS from user agent
function quickPath(type) {
  const isWin =
    navigator.userAgent.includes("Windows") ||
    navigator.platform.includes("Win");
  const isMac = navigator.userAgent.includes("Macintosh");
  const username = ""; // Can't know without backend, just suggest

  const paths = {
    windows: {
      desktop: "C:\\Users\\%USERPROFILE%\\Desktop",
      downloads: "C:\\Users\\%USERPROFILE%\\Downloads",
      videos: "C:\\Users\\%USERPROFILE%\\Videos",
    },
    mac: {
      desktop: "/Users/~/Desktop",
      downloads: "/Users/~/Downloads",
      videos: "/Users/~/Movies",
    },
    linux: {
      desktop: "~/Desktop",
      downloads: "~/Downloads",
      videos: "~/Videos",
    },
  };

  const os = isWin ? "windows" : isMac ? "mac" : "linux";
  document.getElementById("dirInput").value = paths[os][type] || "";
  document.getElementById("dirInput").focus();
}

async function playLocalFile(filePath, fileName) {
  S.isLocal = true;
  S.filePath = filePath;
  S.file = fileName;
  S.audioIdx = 0;
  S.offset = 0;

  document
    .querySelectorAll(".fi")
    .forEach((el) => el.classList.remove("active"));

  vph.style.display = "none";
  showLoad("Loading media info…");
  topNow.innerHTML = `Now playing: <em>${escH(fileName)}</em>`;
  extPill.textContent = (fileName.split(".").pop() || "").toUpperCase();
  extPill.style.display = "";

  try {
    const r = await fetch(`/local-info?path=${encodeURIComponent(filePath)}`);
    if (!r.ok) throw new Error("Server returned " + r.status);
    S.info = await r.json();
    S.duration = S.info.format.duration || 0;
    timeTot.textContent = fmt(S.duration);
    buildAudSel(S.info.audio);
    showLoad("Buffering…");
    loadStream(0, 0);
  } catch (err) {
    hideLoad();
    vph.style.display = "flex";
    showOSD("❌ " + err.message);
  }
}
```

### Update `loadStream` to support local files

```js
function loadStream(startTime, audioIdx) {
  S.offset = startTime;
  if (audioIdx !== undefined) S.audioIdx = audioIdx;
  const hasAudio = S.info && S.info.audio && S.info.audio.length > 0;
  const aidx = hasAudio ? S.audioIdx : -1;

  // Choose route based on source type
  let url;
  if (S.isLocal && S.filePath) {
    url = `/local-stream?path=${encodeURIComponent(S.filePath)}&audio=${aidx}&start=${startTime.toFixed(3)}`;
  } else {
    url = `/stream/${encodeURIComponent(S.file)}?audio=${aidx}&start=${startTime.toFixed(3)}`;
  }

  vid.src = url;
  vid.play().catch(() => {});
}
```

---

## STEP 8 — Controls Bar (Tailwind)

### Seek bar HTML

```html
<div class="px-4 pt-2 pb-1">
  <div
    class="seek-container relative h-4 flex items-center cursor-pointer group"
    id="seekRow"
  >
    <!-- Track -->
    <div
      class="seek-bar relative w-full h-1 bg-white/10 rounded-full transition-all duration-100"
      id="sbar"
    >
      <!-- Buffered -->
      <div
        id="sbuf"
        class="absolute top-0 left-0 h-full bg-white/20 rounded-full pointer-events-none"
      ></div>
      <!-- Played -->
      <div
        id="splayed"
        class="absolute top-0 left-0 h-full bg-vlc-orange rounded-full pointer-events-none"
      ></div>
      <!-- Thumb dot -->
      <div
        id="sdot"
        class="seek-dot absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full opacity-0 transition-opacity shadow-lg pointer-events-none"
      ></div>
    </div>
    <!-- Time tooltip -->
    <div
      id="stip"
      class="absolute -top-6 -translate-x-1/2 bg-black/80 text-white text-[11px] px-2 py-0.5 rounded-md pointer-events-none opacity-0 whitespace-nowrap group-hover:opacity-100"
    >
      0:00
    </div>
  </div>
</div>
```

### Button row HTML

```html
<div class="flex items-center gap-0.5 px-3 pb-2.5">
  <!-- Left: transport controls -->
  <button id="btnPlay" class="btn-ctrl text-xl" title="Play/Pause (Space)">
    ▶
  </button>
  <button id="btnStop" class="btn-ctrl" title="Stop (S)">⏹</button>
  <button id="btnRew" class="btn-ctrl" title="-10s (←)">⏪</button>
  <button id="btnFwd" class="btn-ctrl" title="+10s (→)">⏩</button>

  <div class="w-px h-4 bg-white/10 mx-1 flex-shrink-0"></div>

  <!-- Volume -->
  <button id="btnMute" class="btn-ctrl" title="Mute (M)">🔊</button>
  <input
    type="range"
    id="volRange"
    class="w-16 mx-1"
    min="0"
    max="1"
    step="0.05"
    value="1"
  />

  <!-- Time -->
  <div
    class="text-xs text-white/50 tabular-nums mx-2 whitespace-nowrap flex-shrink-0"
  >
    <span class="text-white" id="timeCur">0:00</span>
    <span> / </span>
    <span id="timeTot">0:00</span>
  </div>

  <!-- Right: audio + speed + extras -->
  <div class="ml-auto flex items-center gap-1">
    <!-- Audio track selector -->
    <div
      id="audWrap"
      class="hidden items-center gap-1.5 bg-vlc-srf2 border border-white/10 rounded-lg px-2.5 py-1"
    >
      <span class="text-[13px]">🎵</span>
      <span class="text-[11px] text-white/50">Audio:</span>
      <select
        id="audSel"
        class="bg-transparent border-none text-white text-xs outline-none cursor-pointer max-w-[130px]"
      ></select>
    </div>

    <div class="w-px h-4 bg-white/10 mx-0.5 flex-shrink-0"></div>

    <!-- Speed -->
    <select
      id="spdSel"
      title="Playback speed"
      class="bg-vlc-srf2 border border-white/10 text-white text-xs px-2 py-1 rounded-lg cursor-pointer outline-none appearance-none"
    >
      <option value="0.25">0.25×</option>
      <option value="0.5">0.5×</option>
      <option value="0.75">0.75×</option>
      <option value="1" selected>1×</option>
      <option value="1.25">1.25×</option>
      <option value="1.5">1.5×</option>
      <option value="2">2×</option>
      <option value="3">3×</option>
    </select>

    <button id="btnLoop" class="btn-ctrl" title="Loop (L)">🔁</button>
    <button id="btnInfo" class="btn-ctrl" title="Media info (I)">ℹ</button>
    <button id="btnFs" class="btn-ctrl" title="Fullscreen (F)">⛶</button>
  </div>
</div>
```

Add this utility class in the `<style>` block:

```css
.btn-ctrl {
  @apply bg-transparent border-none text-white cursor-pointer p-1.5 rounded-md text-[17px]
         flex items-center justify-center leading-none
         hover:bg-white/10 active:scale-90 transition-all flex-shrink-0;
}
.btn-ctrl.on {
  @apply text-vlc-orange;
}
```

---

## STEP 9 — Sidebar Library Tab (Tailwind)

### Tab switcher

```html
<div class="flex border-b border-white/5">
  <button
    id="tabLib"
    onclick="switchTab('library')"
    class="flex-1 py-2 text-xs font-semibold tracking-wide text-vlc-orange border-b-2 border-vlc-orange transition-all"
  >
    Library
  </button>
  <button
    id="tabBrowse"
    onclick="switchTab('browse')"
    class="flex-1 py-2 text-xs font-semibold tracking-wide text-white/40 border-b-2 border-transparent hover:text-white/70 transition-all"
  >
    Browse PC
  </button>
</div>
```

### Library file item

```html
<!-- Each file item in #fileList -->
<div
  class="fi flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-vlc-srf2 group"
  data-name="FILE"
>
  <div
    class="w-[50px] h-[32px] rounded-[5px] bg-vlc-srf3 flex-shrink-0 overflow-hidden flex items-center justify-center text-base"
  >
    <img
      src="/thumbnail/FILENAME"
      class="w-full h-full object-cover"
      onerror="this.parentNode.innerHTML='🎬'"
      alt=""
    />
  </div>
  <div class="flex-1 min-w-0">
    <div class="fi-name text-xs font-medium text-white truncate">FILENAME</div>
    <div class="flex items-center gap-1 mt-0.5">
      <span
        class="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-vlc-srf3 text-vlc-srf3 tracking-wide"
        >EXT</span
      >
      <span class="text-[11px] text-vlc-srf3">SIZE</span>
    </div>
  </div>
  <!-- Actions (visible on hover) -->
  <div
    class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
  >
    <button
      data-add="FILENAME"
      title="Add to playlist"
      class="text-[11px] px-1.5 py-1 rounded bg-vlc-orange/20 text-vlc-orange hover:bg-vlc-orange hover:text-white font-bold transition-all"
    >
      +
    </button>
    <button
      data-del="FILENAME"
      title="Delete"
      class="text-[13px] px-1.5 py-1 rounded text-vlc-srf3 hover:text-vlc-danger hover:bg-red-900/20 transition-all"
    >
      ✕
    </button>
  </div>
</div>
```

Active state (add these classes when `S.file === f.name`):

```
bg-vlc-orange/10 border-l-2 border-vlc-orange
.fi-name → text-vlc-orange2 font-semibold
```

---

## STEP 10 — Playlist Panel (Tailwind)

```html
<!-- Bottom playlist panel -->
<div
  id="plPanel"
  class="flex-shrink-0 bg-vlc-srf border-t border-white/5 transition-all duration-200"
  style="height: 180px"
>
  <!-- toggle between 36px and 180px -->

  <!-- Header -->
  <div
    class="flex items-center gap-1.5 px-3 h-9 border-b border-white/5 flex-shrink-0"
  >
    <!-- Title + count -->
    <span class="text-[10px] font-bold tracking-widest uppercase text-white/40"
      >Playlist</span
    >
    <span
      id="plCount"
      class="text-[10px] px-1.5 py-0.5 rounded-full bg-vlc-srf2 text-white/40"
      >0</span
    >

    <div class="ml-2 flex items-center gap-0.5">
      <!-- Prev -->
      <button onclick="playPrev()" class="btn-ctrl !text-sm" title="Previous">
        ⏮
      </button>
      <!-- Next -->
      <button onclick="playNext()" class="btn-ctrl !text-sm" title="Next">
        ⏭
      </button>
      <!-- Shuffle -->
      <button
        id="btnShuffle"
        onclick="toggleShuffle()"
        class="btn-ctrl !text-xs font-bold px-2 py-1 rounded"
        title="Shuffle"
      >
        🔀
      </button>
      <!-- Repeat -->
      <button
        id="btnRepeat"
        onclick="cycleRepeat()"
        class="btn-ctrl !text-xs font-bold px-2 py-1 rounded"
        title="Repeat"
      >
        🔁 Off
      </button>
      <!-- Clear -->
      <button
        onclick="clearPlaylist()"
        class="btn-ctrl !text-xs text-vlc-srf3 hover:text-vlc-danger px-2"
        title="Clear playlist"
      >
        🗑
      </button>
    </div>

    <!-- Toggle collapse -->
    <button
      id="btnPlToggle"
      onclick="togglePlaylist()"
      class="ml-auto btn-ctrl !text-xs"
      title="Toggle playlist"
    >
      ∨
    </button>
  </div>

  <!-- Playlist items -->
  <div
    id="plList"
    class="overflow-y-auto custom-scroll"
    style="height: calc(180px - 36px)"
  >
    <!-- rendered by renderPlaylist() -->
  </div>
</div>
```

### Toggle collapse

```js
function togglePlaylist() {
  S.plOpen = !S.plOpen;
  const panel = document.getElementById("plPanel");
  const btn = document.getElementById("btnPlToggle");
  panel.style.height = S.plOpen ? "180px" : "36px";
  btn.textContent = S.plOpen ? "∨" : "∧";
  const list = document.getElementById("plList");
  list.style.display = S.plOpen ? "" : "none";
}
```

---

## STEP 11 — Playlist Navigation

```js
function playNext() {
  if (!S.playlist.length) return;
  let next;
  if (S.shuffle) {
    next = Math.floor(Math.random() * S.playlist.length);
  } else {
    next = S.plIndex + 1;
    if (next >= S.playlist.length) {
      if (S.repeat === "all") next = 0;
      else return showOSD("End of playlist");
    }
  }
  playFromPlaylist(next);
}

function playPrev() {
  if (!S.playlist.length) return;
  let prev = S.plIndex - 1;
  if (prev < 0) prev = S.repeat === "all" ? S.playlist.length - 1 : 0;
  playFromPlaylist(prev);
}

function toggleShuffle() {
  S.shuffle = !S.shuffle;
  document.getElementById("btnShuffle").classList.toggle("on", S.shuffle);
  showOSD(S.shuffle ? "🔀 Shuffle ON" : "🔀 Shuffle OFF");
}

function cycleRepeat() {
  const modes = ["off", "one", "all"];
  S.repeat = modes[(modes.indexOf(S.repeat) + 1) % modes.length];
  const labels = { off: "🔁 Off", one: "🔂 One", all: "🔁 All" };
  document.getElementById("btnRepeat").textContent = labels[S.repeat];
  document
    .getElementById("btnRepeat")
    .classList.toggle("on", S.repeat !== "off");
  showOSD(`Repeat: ${S.repeat}`);
}
```

---

## STEP 12 — Key Invariants (Do Not Break)

### `actualTime()` — MUST be correct for all seeking to work

```js
// S.offset is set in loadStream() = the startTime we passed to ffmpeg
// vid.currentTime = seconds elapsed since stream started (starts at 0)
// Actual position in video = S.offset + vid.currentTime
function actualTime() {
  return S.offset + (vid.currentTime || 0);
}
```

### `loadStream()` — always update S.offset

```js
function loadStream(startTime, audioIdx) {
  S.offset = startTime; // ← MUST update offset
  if (audioIdx !== undefined) S.audioIdx = audioIdx;
  const hasAudio = S.info?.audio?.length > 0;
  const aidx = hasAudio ? S.audioIdx : -1;

  // local file vs uploaded file
  const url =
    S.isLocal && S.filePath
      ? `/local-stream?path=${encodeURIComponent(S.filePath)}&audio=${aidx}&start=${startTime.toFixed(3)}`
      : `/stream/${encodeURIComponent(S.file)}?audio=${aidx}&start=${startTime.toFixed(3)}`;

  vid.src = url;
  vid.play().catch(() => {});
}
```

### Reset `isLocal` / `filePath` on every new playback

```js
// In playFile() (uploaded file):
S.isLocal = false;
S.filePath = null;

// In playLocalFile() (browse PC file):
S.isLocal = true;
S.filePath = filePath;
```

---

## STEP 13 — Complete Implementation Checklist

- [ ] `npm install` with new package.json
- [ ] `index.js` — add `/browse`, `/local-info`, `/local-thumb`, `/local-stream` routes
- [ ] `index.html` — full Tailwind rewrite:
  - [ ] Tailwind CDN + custom config + minimal `<style>` block
  - [ ] Topbar with VLC badge, title, now-playing, ext pill
  - [ ] Left sidebar with tab switcher (Library / Browse PC)
  - [ ] Library tab: upload zone + file list with Add/Delete per item
  - [ ] Browse PC tab: path input + Scan button + quick shortcuts + file list
  - [ ] Video area: `<video>` + placeholder + loading + flash + OSD + info panel
  - [ ] Controls: seek bar + button row (all buttons including prev/next)
  - [ ] Playlist panel: collapsible bottom bar with all controls
  - [ ] JS state with playlist array, shuffle, repeat, isLocal
  - [ ] `addToPlaylist()`, `renderPlaylist()`, `playFromPlaylist()`, `removeFromPlaylist()`, `clearPlaylist()`
  - [ ] `playNext()`, `playPrev()`, `toggleShuffle()`, `cycleRepeat()`
  - [ ] `browseDir()`, `renderBrowseList()`, `playLocalFile()`, `quickPath()`
  - [ ] `loadStream()` updated for local/uploaded duality
  - [ ] `vid.ended` handler with playlist auto-advance + repeat/shuffle
  - [ ] All keyboard shortcuts preserved

---

## STEP 14 — Run & Test

```bash
npm install
npm start   # → http://localhost:8000
```

**Test checklist:**

1. Upload an MP4 → plays, seek works, time shows correctly
2. Upload an MKV with 2 audio tracks → Audio selector shows, switching works
3. Browse PC tab → enter a folder path → videos listed → click plays → seek works
4. Add 3 files to playlist → playlist shows → clicking plays correct file → video auto-advances
5. Shuffle mode → next is random
6. Repeat One → same video loops
7. Repeat All → playlist wraps around
8. Fullscreen → controls overlay at bottom
9. Keyboard shortcuts all work
