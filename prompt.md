# Claude Code Prompt — Online Video URL Streaming

> Read `index.js` AND `index.html` fully before making any change.

---

## WHAT IS BEING ADDED

| URL type                                                            | How it plays               | Why                                                      |
| ------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `.m3u8` / HLS                                                       | hls.js (client-side)       | Native browser HLS, live stream support, zero server CPU |
| `.mp4`, `.webm`, `.m4v`, `.ogg`                                     | `<video src>` direct       | Browser-native, zero server CPU                          |
| Everything else (`.mkv`, `.avi`, `.flv`, `.ts`, `.mpd`, `rtmp://…`) | `/stream-url` ffmpeg proxy | Server transcodes → fragmented MP4                       |

**Streaming modes for URL videos:**

- HLS (hls.js): `vid.currentTime` = real time → same as `isDirect`
- Direct: `vid.currentTime` = real time → same as `isDirect`
- Proxy (ffmpeg): `S.offset + vid.currentTime` → same as local transcoded

---

## PART A — `index.js` (2 new routes)

### A1 — Add `/info-url` route

**FIND** (between `/info` and `/thumb`):

```js
/* ── GET /thumb?path=... ─────────────────────────────────────────────────── */
```

**INSERT BEFORE IT:**

```js
/* ── GET /info-url?url=... ───────────────────────────────────────────────── */
app.get("/info-url", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  // 15-second timeout — some streams are slow to respond
  let done = false;
  const timer = setTimeout(() => {
    if (!done) {
      done = true;
      res.status(408).json({ error: "Probe timeout" });
    }
  }, 15000);

  ffmpeg.ffprobe(url, (err, meta) => {
    clearTimeout(timer);
    if (done || res.headersSent) return;
    done = true;
    if (err) return res.status(500).json({ error: err.message });

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
        };
      });
    const rawDur = parseFloat(meta.format.duration);
    res.json({
      format: {
        name: meta.format.format_long_name || meta.format.format_name,
        duration: isFinite(rawDur) ? rawDur : 0,
        size: parseInt(meta.format.size) || 0,
        bitrate: parseInt(meta.format.bit_rate) || 0,
        title: meta.format.tags?.title || null,
      },
      video,
      audio,
    });
  });
});
```

### A2 — Add `/stream-url` route

**FIND** (just before the SIGINT handler at bottom of file):

```js
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => {
```

**INSERT BEFORE IT:**

```js
/* ── GET /stream-url?url=...&audio=0&start=0 ─────────────────────────────
   Proxy any online URL through ffmpeg → fragmented MP4 → browser.
   Supports: HTTP/S video files, HLS, DASH, RTMP, RTSP, and anything ffmpeg
   can read. Zero local-file access — URL is fetched by ffmpeg on the server.
*/
app.get("/stream-url", (req, res) => {
  const url = req.query.url;
  const audioIdx = Math.max(-1, parseInt(req.query.audio ?? "0", 10));
  const startSec = Math.max(0, parseFloat(req.query.start ?? "0"));

  if (!url) return res.status(400).end();

  const sid = ++streamSeq;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");

  const cmd = ffmpeg(url)
    .setStartTime(startSec)
    .addOption("-map", "0:V:0")
    .videoCodec("libx264")
    .addOption("-preset", "ultrafast")
    .addOption("-tune", "zerolatency")
    .addOption("-avoid_negative_ts", "make_zero")
    .addOption("-max_interleave_delta", "0")
    .outputOptions(["-movflags", "frag_keyframe+empty_moov+default_base_moof"]);

  if (audioIdx >= 0) {
    cmd
      .addOption("-map", `0:a:${audioIdx}`)
      .audioCodec("aac")
      .addOption("-b:a", "192k")
      .addOption("-ac", "2")
      .addOption("-ar", "48000");
  } else {
    cmd.addOption("-an");
  }

  cmd
    .format("mp4")
    .on("start", (cl) => console.log(`[url #${sid}] ${cl.slice(0, 250)}`))
    .on("error", (err, _o, stderr) => {
      if (err.message?.includes("SIGKILL")) return;
      console.error(`[url #${sid}] Error: ${err.message}`);
      if (stderr) console.error(`[url #${sid}] stderr:\n${stderr.slice(-500)}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
      activeStreams.delete(sid);
    })
    .on("end", () => activeStreams.delete(sid));

  const chunker = make1MBChunker();
  activeStreams.set(sid, cmd);
  req.on("close", () => {
    try {
      cmd.kill("SIGKILL");
    } catch {}
    chunker.destroy();
    activeStreams.delete(sid);
  });
  cmd.pipe(chunker).pipe(res);
});
```

---

## PART B — `index.html` (HTML changes)

### B1 — Add hls.js CDN in `<head>`

**FIND:**

```html
<script src="https://cdn.tailwindcss.com"></script>
```

**REPLACE WITH:**

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
```

### B2 — Add URL input section in sidebar

**FIND** (end of the FOLDER INPUT div — right before RECENT FOLDERS comment):

```html
<!-- RECENT FOLDERS: FIX 1 — style="display:none" not hidden class -->
```

**INSERT BEFORE IT:**

```html
<!-- STREAM URL ── online video URL / HLS / proxy -->
<div class="px-3 py-2.5 flex-shrink-0 border-b border-white/5 space-y-2">
  <div class="text-[10px] font-bold tracking-widest uppercase text-white/30">
    🌐 Stream URL
  </div>
  <div class="flex gap-2">
    <input
      id="urlInput"
      type="text"
      placeholder="https://…/video.mp4  ·  .m3u8  ·  .mkv  ·  rtmp://…"
      class="flex-1 bg-vlc-srf2 border border-white/10 rounded-lg px-3 py-2 text-xs text-white
                        placeholder-white/20 outline-none focus:border-vlc-orange/50 transition-colors min-w-0"
    />
    <button
      onclick="playUrl()"
      class="px-3 py-2 bg-vlc-orange hover:bg-vlc-orange2 rounded-lg text-xs font-bold
                         text-white transition-colors flex-shrink-0"
    >
      Load
    </button>
  </div>
  <div id="urlStatus" class="text-[11px] min-h-[14px] text-white/30"></div>
</div>
```

### B3 — Add `#liveBadge` in time display

**FIND:**

```html
<div
  class="text-xs text-white/40 tabular-nums mx-2 whitespace-nowrap flex-shrink-0"
>
  <span class="text-white" id="timeCur">0:00</span><span class="mx-0.5">/</span
  ><span id="timeTot">0:00</span>
</div>
```

**REPLACE WITH:**

```html
<div
  class="text-xs text-white/40 tabular-nums mx-2 whitespace-nowrap flex-shrink-0 flex items-center gap-1.5"
>
  <span class="text-white" id="timeCur">0:00</span
  ><span class="mx-0.5 text-white/30">/</span><span id="timeTot">0:00</span>
  <span
    id="liveBadge"
    style="display:none"
    class="text-[9px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide animate-pulse"
  >
    ● LIVE
  </span>
</div>
```

---

## PART C — `index.html` (JavaScript changes)

### C1 — Extend `const S` with URL state

**FIND:**

```js
      autoplay:    true,        // auto-advance to next file when video ends
      currentDir:  '',          // currently browsed directory path
      isPip:       false,       // picture-in-picture active
```

**REPLACE WITH:**

```js
      autoplay:    true,        // auto-advance to next file when video ends
      currentDir:  '',          // currently browsed directory path
      isPip:       false,       // picture-in-picture active
      isUrl:       false,       // true = playing from online URL (not local file)
      streamUrl:   '',          // the URL being streamed
      isLive:      false,       // true = live stream (no duration, no seek)
      isHls:       false,       // true = HLS stream via hls.js
```

### C2 — Add `hlsInstance` module-level variable

**FIND:**

```js
const $ = (id) => document.getElementById(id);
const vid = $("vid");
```

**REPLACE WITH:**

```js
const $ = (id) => document.getElementById(id);
const vid = $("vid");
let hlsInstance = null; // hls.js instance for M3U8 streams
```

### C3 — Update `actualTime()` to handle HLS

**FIND:**

```js
// CRITICAL: transcode = S.offset + vid.currentTime; direct = vid.currentTime
function actualTime() {
  return S.isDirect ? vid.currentTime : S.offset + vid.currentTime;
}
```

**REPLACE WITH:**

```js
// CRITICAL: transcode = S.offset + vid.currentTime; direct/HLS/URL-direct = vid.currentTime
function actualTime() {
  return S.isDirect || S.isHls ? vid.currentTime : S.offset + vid.currentTime;
}
```

### C4 — Add all URL helper functions

**FIND** (the start of the canDirect function):

```js
/* ── FIX 5: canDirect checks BOTH video AND audio codec ─────────────────── */
```

**INSERT BEFORE IT:**

```js
/* ── URL STREAMING HELPERS ───────────────────────────────────────────────── */

// Detect how to play a URL: 'hls' | 'direct' | 'proxy'
function detectUrlMode(url) {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.includes(".m3u8")) return "hls";
  const directExts = [".mp4", ".m4v", ".webm", ".ogg", ".ogv"];
  if (directExts.some((ext) => lower.endsWith(ext))) return "direct";
  return "proxy"; // .mkv .avi .flv .ts .mpd rtmp:// rtsp:// → ffmpeg
}

// Extract a display title from a URL
function urlTitle(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : u.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

// Destroy active HLS instance cleanly
function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  S.isHls = false;
}

// Update UI for live vs VOD streams
function updateLiveUI(isLive) {
  $("liveBadge").style.display = isLive ? "" : "none";
  if (isLive) {
    $("timeTot").textContent = "";
    $("timeCur").textContent = "LIVE";
    $("splayed").style.width = "100%"; // full orange bar for live
  }
  const st = $("urlStatus");
  if (st) {
    st.textContent = isLive ? "● Live stream" : "";
    st.style.color = isLive ? "#f87171" : "rgba(255,255,255,.3)";
  }
}

// Set up hls.js for an M3U8 URL
function setupHls(url) {
  if (typeof Hls === "undefined") {
    showOSD("⚠️ hls.js failed to load");
    return;
  }
  if (Hls.isSupported()) {
    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
    });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(vid);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      hideLoad();
      // Detect live vs VOD from the manifest
      const isLive = hlsInstance.levels?.[0]?.details?.live !== false;
      S.isLive = isLive;
      updateLiveUI(isLive);
      if (!isLive && isFinite(vid.duration) && vid.duration > 0) {
        S.duration = vid.duration;
        $("timeTot").textContent = fmt(S.duration);
      }
      // Expose audio tracks if multiple exist
      if (data.audioTracks && data.audioTracks.length > 1) {
        const tracks = data.audioTracks.map((t, i) => ({
          index: i,
          codec: "",
          channels: 0,
          channelLayout: "",
          sampleRate: 0,
          language: t.lang || "und",
          title: t.name || null,
          label: t.name || (t.lang ? t.lang.toUpperCase() : `Track ${i + 1}`),
          isDefault: i === 0,
        }));
        buildAudSel(tracks);
      }
      vid.play().catch(() => {
        hideLoad();
        showCTP();
      });
    });
    hlsInstance.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          showOSD("⚠️ HLS network error — retrying…");
          hlsInstance.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          showOSD("⚠️ HLS media error — recovering…");
          hlsInstance.recoverMediaError();
          break;
        default:
          showOSD("⚠️ HLS fatal: " + data.details);
          destroyHls();
          break;
      }
    });
  } else if (vid.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari native HLS
    S.isDirect = true;
    vid.src = url;
    vid.play().catch(() => {
      hideLoad();
      showCTP();
    });
  } else {
    showOSD("⚠️ HLS not supported — falling back to proxy");
    loadUrlStream(0);
  }
}

// Main URL player entry point
async function playUrl(inputUrl) {
  const url = (inputUrl || $("urlInput")?.value || "").trim();
  if (!url) {
    showOSD("⚠️ Enter a URL first");
    return;
  }

  // Stop any existing local file or URL stream
  destroyHls();
  S.isUrl = true;
  S.streamUrl = url;
  S.isHls = false;
  S.isLive = false;
  S.filePath = null;
  S.fileName = urlTitle(url);
  S.audioIdx = 0;
  S.offset = 0;
  S.isDirect = false;
  S.info = null;
  S.duration = 0;

  $("vph").style.display = "none";
  $("liveBadge").style.display = "none";
  $("audWrap").style.display = "none";
  $("timeTot").textContent = "0:00";
  showLoad("Connecting…");
  $("topNow").innerHTML =
    `Streaming: <em class="text-white/50">${escH(S.fileName)}</em>`;

  const mode = detectUrlMode(url);

  if (mode === "hls") {
    S.isHls = true;
    S.isLive = true; // assume live until manifest says otherwise
    $("extPill").textContent = "HLS";
    $("extPill").style.display = "";
    updateLiveUI(true);
    setupHls(url);
    return;
  }

  // For direct/proxy: try to probe the URL for duration + audio tracks
  const st = $("urlStatus");
  if (st) {
    st.textContent = "Probing…";
    st.style.color = "rgba(255,255,255,.3)";
  }
  try {
    const r = await fetch(`/info-url?url=${encodeURIComponent(url)}`);
    if (r.ok) {
      S.info = await r.json();
      S.duration = S.info.format?.duration || 0;
      S.isLive = !isFinite(S.duration) || S.duration < 0.5;
    }
  } catch {
    /* probe failed — treat as live/unknown */
  }

  const extLabel =
    url.split(".").pop()?.split("?")[0]?.toUpperCase().slice(0, 5) || "URL";
  $("extPill").textContent = mode === "direct" ? extLabel : "PROXY";
  $("extPill").style.display = "";

  updateLiveUI(S.isLive);
  if (!S.isLive && S.duration > 0) {
    $("timeTot").textContent = fmt(S.duration);
    if (S.info?.audio?.length) buildAudSel(S.info.audio);
  }
  if (st) {
    st.textContent = "";
  }

  if (mode === "direct") {
    S.isDirect = true;
    vid.src = url;
    vid.play().catch(() => {
      hideLoad();
      showCTP();
    });
  } else {
    loadUrlStream(0);
  }
}

// Load/seek a URL proxy stream through /stream-url
function loadUrlStream(startTime, audioIdx) {
  S.offset = startTime;
  if (audioIdx !== undefined) S.audioIdx = audioIdx;
  const aidx = S.info?.audio?.length > 0 ? S.audioIdx : -1;
  const vol = vid.volume || parseFloat($("volRange").value) || 1,
    muted = vid.muted;
  vid.src = `/stream-url?url=${encodeURIComponent(S.streamUrl)}&audio=${aidx}&start=${startTime.toFixed(3)}`;
  vid.volume = vol;
  vid.muted = muted;
  const p = vid.play();
  if (p)
    p.catch((err) => {
      if (err.name === "NotAllowedError" || err.name === "NotSupportedError") {
        hideLoad();
        showCTP();
      } else console.warn("[url-play]", err.name, err.message);
    });
}
```

### C5 — Update `stopAll()` to clean up URL/HLS state

**FIND:**

```js
function stopAll() {
  // Exit PiP before clearing src — browser throws if src cleared while in PiP
  if (document.pictureInPictureElement === vid) {
    document.exitPictureInPicture().catch(() => {});
  }
  vid.pause();
  vid.src = "";
  S.filePath = null;
  S.fileName = null;
  S.info = null;
  S.duration = 0;
  S.offset = 0;
  S.isDirect = false;
  S.isPip = false;
  $("vph").style.display = "flex";
  hideLoad();
  hideCTP();
  $("btnPlay").textContent = "▶";
  $("splayed").style.width = "0";
  $("sbuf").style.width = "0";
  $("timeCur").textContent = "0:00";
  $("timeTot").textContent = "0:00";
  $("topNow").textContent = "No file loaded";
  $("extPill").style.display = "none";
  $("audWrap").style.display = "none";
}
```

**REPLACE WITH:**

```js
function stopAll() {
  if (document.pictureInPictureElement === vid)
    document.exitPictureInPicture().catch(() => {});
  destroyHls();
  vid.pause();
  vid.src = "";
  S.filePath = null;
  S.fileName = null;
  S.info = null;
  S.duration = 0;
  S.offset = 0;
  S.isDirect = false;
  S.isPip = false;
  S.isUrl = false;
  S.streamUrl = "";
  S.isLive = false;
  S.isHls = false;
  $("vph").style.display = "flex";
  hideLoad();
  hideCTP();
  $("btnPlay").textContent = "▶";
  $("splayed").style.width = "0";
  $("sbuf").style.width = "0";
  $("timeCur").textContent = "0:00";
  $("timeTot").textContent = "0:00";
  $("liveBadge").style.display = "none";
  const st = $("urlStatus");
  if (st) {
    st.textContent = "";
  }
  $("topNow").textContent = "No file loaded";
  $("extPill").style.display = "none";
  $("audWrap").style.display = "none";
}
```

### C6 — Update `playFile()` to reset URL state when playing local file

**FIND** the start of `playFile()`:

```js
    async function playFile(filePath, fileName) {
      S.filePath = filePath; S.fileName = fileName; S.audioIdx = 0; S.offset = 0; S.isDirect = false;
```

**REPLACE WITH:**

```js
    async function playFile(filePath, fileName) {
      // Stop any URL stream / HLS before playing a local file
      destroyHls();
      S.isUrl = false; S.streamUrl = ''; S.isLive = false;
      $('liveBadge').style.display = 'none';
      const st = $('urlStatus'); if (st) st.textContent = '';
      S.filePath = filePath; S.fileName = fileName; S.audioIdx = 0; S.offset = 0; S.isDirect = false;
```

### C7 — Update `durationchange` to handle HLS and URL direct streams

**FIND:**

```js
vid.addEventListener("durationchange", () => {
  if (S.isDirect && isFinite(vid.duration)) {
    S.duration = vid.duration;
    $("timeTot").textContent = fmt(S.duration);
  }
});
```

**REPLACE WITH:**

```js
vid.addEventListener("durationchange", () => {
  if (
    (S.isDirect || S.isHls) &&
    isFinite(vid.duration) &&
    vid.duration > 0 &&
    !S.isLive
  ) {
    S.duration = vid.duration;
    $("timeTot").textContent = fmt(S.duration);
  }
});
```

### C8 — Update `timeupdate` to show elapsed time on live streams

**FIND:**

```js
vid.addEventListener("timeupdate", () => {
  if (!S.duration) return;
  const t = actualTime(),
    pct = Math.min(t / S.duration, 1) * 100;
  $("splayed").style.width = pct + "%";
  $("sdot").style.left = pct + "%";
  $("timeCur").textContent = fmt(t);
});
```

**REPLACE WITH:**

```js
vid.addEventListener("timeupdate", () => {
  const t = actualTime();
  if (S.isLive) {
    $("timeCur").textContent = fmt(t);
    return;
  } // show elapsed, no seek bar
  if (!S.duration) return;
  const pct = Math.min(t / S.duration, 1) * 100;
  $("splayed").style.width = pct + "%";
  $("sdot").style.left = pct + "%";
  $("timeCur").textContent = fmt(t);
});
```

### C9 — Update `progress` event to skip live streams

**FIND:**

```js
vid.addEventListener("progress", () => {
  if (!vid.buffered.length || !S.duration) return;
  const end = vid.buffered.end(vid.buffered.length - 1);
  $("sbuf").style.width =
    Math.min((S.isDirect ? end : S.offset + end) / S.duration, 1) * 100 + "%";
});
```

**REPLACE WITH:**

```js
vid.addEventListener("progress", () => {
  if (!vid.buffered.length || !S.duration || S.isLive) return;
  const end = vid.buffered.end(vid.buffered.length - 1);
  $("sbuf").style.width =
    Math.min((S.isDirect || S.isHls ? end : S.offset + end) / S.duration, 1) *
      100 +
    "%";
});
```

### C10 — Update `ended` handler — premature-end reload + skip auto-next for URL

**FIND:**

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

**REPLACE WITH:**

```js
vid.addEventListener("ended", () => {
  const t = actualTime(),
    nearEnd = S.duration - t < 2;

  // Premature end on transcoded local stream — reload from current position
  if (!nearEnd && S.filePath && !S.isDirect) {
    loadStream(t);
    return;
  }

  // Premature end on proxy URL stream — reload from current position
  if (!nearEnd && S.isUrl && !S.isDirect && !S.isHls) {
    loadUrlStream(t);
    return;
  }

  // Loop current video (local or URL)
  if (S.looping) {
    if (S.isUrl && !S.isHls) {
      loadUrlStream(0);
      return;
    }
    if (S.isUrl && S.isHls) {
      vid.currentTime = 0;
      vid.play();
      return;
    }
    if (S.filePath) {
      loadStream(0);
      return;
    }
  }

  // Auto-next: local files only (URLs have no playlist)
  if (!S.isUrl && S.autoplay && S._lastFiles?.length > 0 && S.filePath) {
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

### C11 — Update `error` event to cover URL streams

**FIND:**

```js
vid.addEventListener("error", () => {
  hideLoad();
  if (S.filePath) showOSD("⚠️ Stream error — check console");
});
```

**REPLACE WITH:**

```js
vid.addEventListener("error", () => {
  hideLoad();
  if (S.filePath || S.isUrl) showOSD("⚠️ Stream error — check console");
});
```

### C12 — Update `togglePlay()` to allow play when URL is active

**FIND:**

```js
    function togglePlay() {
      if (!S.filePath) return; hideCTP();
```

**REPLACE WITH:**

```js
    function togglePlay() {
      if (!S.filePath && !S.isUrl) return; hideCTP();
```

### C13 — Update `btnRew` / `btnFwd` for URL and live-stream guards

**FIND:**

```js
$("btnRew").addEventListener("click", () => {
  if (!S.filePath) return;
  const t = Math.max(0, actualTime() - 10);
  if (S.isDirect) {
    vid.currentTime = t;
    showOSD(`⏪ ${fmt(t)}`);
  } else {
    showLoad("Seeking…");
    loadStream(t);
    showOSD(`⏪ ${fmt(t)}`);
  }
});
$("btnFwd").addEventListener("click", () => {
  if (!S.filePath) return;
  const t = Math.min(S.duration || 999999, actualTime() + 10);
  if (S.isDirect) {
    vid.currentTime = t;
    showOSD(`⏩ ${fmt(t)}`);
  } else {
    showLoad("Seeking…");
    loadStream(t);
    showOSD(`⏩ ${fmt(t)}`);
  }
});
```

**REPLACE WITH:**

```js
$("btnRew").addEventListener("click", () => {
  if (!S.filePath && !S.isUrl) return;
  if (S.isLive) {
    showOSD("⚠️ Cannot seek live stream");
    return;
  }
  const t = Math.max(0, actualTime() - 10);
  if (S.isDirect || S.isHls) {
    vid.currentTime = t;
    showOSD(`⏪ ${fmt(t)}`);
  } else if (S.isUrl) {
    showLoad("Seeking…");
    loadUrlStream(t);
    showOSD(`⏪ ${fmt(t)}`);
  } else {
    showLoad("Seeking…");
    loadStream(t);
    showOSD(`⏪ ${fmt(t)}`);
  }
});
$("btnFwd").addEventListener("click", () => {
  if (!S.filePath && !S.isUrl) return;
  if (S.isLive) {
    showOSD("⚠️ Cannot seek live stream");
    return;
  }
  const t = Math.min(S.duration || 999999, actualTime() + 10);
  if (S.isDirect || S.isHls) {
    vid.currentTime = t;
    showOSD(`⏩ ${fmt(t)}`);
  } else if (S.isUrl) {
    showLoad("Seeking…");
    loadUrlStream(t);
    showOSD(`⏩ ${fmt(t)}`);
  } else {
    showLoad("Seeking…");
    loadStream(t);
    showOSD(`⏩ ${fmt(t)}`);
  }
});
```

### C14 — Update seek bar click for URL and live guard

**FIND:**

```js
sbar.addEventListener("click", (e) => {
  if (!S.filePath || !S.duration) return;
  const r = sbar.getBoundingClientRect(),
    pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    t = pct * S.duration;
  if (S.isDirect) {
    vid.currentTime = t;
    showOSD(`⏩ ${fmt(t)}`);
  } else {
    showLoad("Seeking…");
    loadStream(t);
    showOSD(`⏩ ${fmt(t)}`);
  }
});
```

**REPLACE WITH:**

```js
sbar.addEventListener("click", (e) => {
  if (!S.filePath && !S.isUrl) return;
  if (S.isLive || !S.duration) {
    if (S.isLive) showOSD("⚠️ Cannot seek live stream");
    return;
  }
  const r = sbar.getBoundingClientRect(),
    pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    t = pct * S.duration;
  if (S.isDirect || S.isHls) {
    vid.currentTime = t;
    showOSD(`⏩ ${fmt(t)}`);
  } else if (S.isUrl) {
    showLoad("Seeking…");
    loadUrlStream(t);
    showOSD(`⏩ ${fmt(t)}`);
  } else {
    showLoad("Seeking…");
    loadStream(t);
    showOSD(`⏩ ${fmt(t)}`);
  }
});
```

### C15 — Update audio track switcher for URL proxy streams

**FIND:**

```js
$("audSel").addEventListener("change", () => {
  const idx = parseInt($("audSel").value, 10);
  if (idx === S.audioIdx) return;
  const t = actualTime();
  S.audioIdx = idx;
  showOSD(`🎵 Audio: ${S.info?.audio[idx]?.label || "Track " + (idx + 1)}`);
  showLoad("Switching audio…");
  loadStream(t, idx);
  if (S.showInfo) buildInfo();
});
```

**REPLACE WITH:**

```js
$("audSel").addEventListener("change", () => {
  const idx = parseInt($("audSel").value, 10);
  if (idx === S.audioIdx) return;
  const t = actualTime();
  S.audioIdx = idx;
  showOSD(`🎵 Audio: ${S.info?.audio[idx]?.label || "Track " + (idx + 1)}`);
  showLoad("Switching audio…");
  if (S.isUrl && !S.isHls) loadUrlStream(t, idx);
  else if (!S.isUrl) {
    loadStream(t, idx);
    if (S.showInfo) buildInfo();
  }
});
```

### C16 — Add Enter key listener for URL input in INIT

**FIND:**

```js
$("pathInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    scanFolder();
  }
});
```

**REPLACE WITH:**

```js
$("pathInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    scanFolder();
  }
});
$("urlInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    playUrl();
  }
});
```

---

## COMPLETE DIFF SUMMARY

```
index.js:
  + GET /info-url?url=...     (ffprobe with 15s timeout)
  + GET /stream-url?url=...   (ffmpeg proxy, identical to /stream but URL source)

index.html <head>:
  + hls.js CDN script tag

index.html HTML:
  + #urlInput section (between Video Folder and Recent)
  + #liveBadge span  (inside time display div)

index.html JS state/vars:
  + S.isUrl, S.streamUrl, S.isLive, S.isHls
  + let hlsInstance = null

index.html JS functions (new):
  + detectUrlMode(url)   → 'hls' | 'direct' | 'proxy'
  + urlTitle(url)        → display name from URL
  + destroyHls()         → clean up hls.js
  + updateLiveUI(bool)   → show/hide LIVE badge
  + setupHls(url)        → hls.js init + error recovery
  + playUrl(url?)        → main URL player entry point
  + loadUrlStream(t, a?) → seek/load URL proxy stream

index.html JS functions (updated):
  ~ actualTime()         → include S.isHls in isDirect branch
  ~ stopAll()            → destroyHls() + reset URL state + hide liveBadge
  ~ playFile()           → destroyHls() + reset URL state at top
  ~ durationchange       → include S.isHls
  ~ timeupdate           → show elapsed time for live streams
  ~ progress             → skip for live, include S.isHls
  ~ ended                → URL premature-end, URL loop, skip auto-next for URL
  ~ error                → include S.isUrl
  ~ togglePlay()         → include S.isUrl guard
  ~ btnRew / btnFwd      → URL guard + live guard + loadUrlStream branch
  ~ sbar click           → URL guard + live guard + loadUrlStream branch
  ~ audSel change        → loadUrlStream for URL proxy
  ~ INIT                 → urlInput Enter keydown
```

---

## TEST CHECKLIST

```bash
node index.js   # → http://localhost:9090
```

**Direct MP4:**

1. Paste `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`
2. Click Load → video plays, duration shows, seek works

**HLS VOD:** 3. Paste `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` 4. Load → HLS badge, plays, seek works (VOD manifest)

**HLS Live:** 5. Any live `.m3u8` URL → red `● LIVE` badge, seek buttons disabled with OSD warning

**RTMP / proxy format:** 6. Paste an `.mkv` or `.avi` HTTP URL → `PROXY` badge, ffmpeg transcodes it

**Controls while streaming URL:** 7. ⏪ / ⏩ seek buttons work for VOD, blocked for LIVE 8. Click seek bar: works for VOD, blocked for LIVE 9. Volume / mute / speed / PiP all work 10. Press S (stop) → URL clears, local files still in sidebar

**Local file after URL:** 11. While URL is playing, click a local file → HLS/proxy stops, local file plays

```

```
