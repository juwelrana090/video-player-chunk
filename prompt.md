# Claude Code Prompt — Fix ffmpeg ENOENT + All Video Compatibility

> Read `index.js` and `package.json` fully before making any change.

---

## ROOT CAUSES

### Bug 1 — ENOENT: ffmpeg.exe not found

```
Error: spawn D:\Projects\video-player-chunk\node_modules\ffmpeg-static\ffmpeg.exe ENOENT
```

**Why:** You are using **Bun** (bun.lock present).
Bun does NOT run npm post-install scripts.
`ffmpeg-static` downloads its binary via a post-install script → Bun skips it →
the folder structure exists but `ffmpeg.exe` was never downloaded.

**Fix:** Replace `ffmpeg-static` with `@ffmpeg-installer/ffmpeg`.
This package **bundles the binary directly inside the package** as a real file.
No download script. Works with Bun, npm, pnpm, and yarn equally.

### Bug 2 — Videos with odd dimensions silently fail

**Why:** libx264 requires width AND height to be divisible by 2.
Phone videos, screen recordings, and many MKV files have odd dimensions.
ffmpeg exits with "width not divisible by 2" — user sees nothing playing.

**Fix:** Add `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2` to the transcode command.
This rounds odd dimensions down to the nearest even number — invisible to the viewer.

### Bug 3 — HDR, 10-bit, and unusual pixel format videos fail

**Why:** Some MKV/HEVC files use yuv420p10le, yuv444p, or NV12 pixel formats.
libx264 cannot encode all of these. Browser cannot decode all of them.

**Fix:** Add `-pix_fmt yuv420p` to force 8-bit 4:2:0 — browser-safe output.

### Bug 4 — No startup validation → silent crash with no hint

**Why:** The current code calls `ffmpeg.setFfmpegPath(ffmpegBin)` without checking
if the file exists. Server starts, user loads page, first video fails with an opaque error.

**Fix:** Check binary exists at startup, log clear instructions if not.

---

## CHANGE 1 — `package.json`: swap `ffmpeg-static` for `@ffmpeg-installer/ffmpeg`

**FIND:**

```json
    "ffmpeg-static": "^5.2.0",
```

**REPLACE WITH:**

```json
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
```

Then run in the project root:

```bash
bun install
# or: npm install
```

---

## CHANGE 2 — `index.js`: fix imports and add startup validation

**FIND** these exact lines at the top of `index.js`:

```js
const ffmpegBin = require("ffmpeg-static");
const ffprobeBin = require("@ffprobe-installer/ffprobe").path;

ffmpeg.setFfmpegPath(ffmpegBin);
ffmpeg.setFfprobePath(ffprobeBin);
```

**REPLACE WITH:**

```js
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeBin = require("@ffprobe-installer/ffprobe").path;

// ── Startup validation ─────────────────────────────────────────────────────
// @ffmpeg-installer bundles the binary directly — no post-install download.
// Works with Bun, npm, pnpm, and yarn without any post-install script.
(function validateBinaries() {
  const ffmpegPath = ffmpegInstaller.path;
  const ffprobePath = ffprobeBin;
  const missing = [];

  if (!ffmpegPath || !fs.existsSync(ffmpegPath))
    missing.push("ffmpeg  → run: bun install (or npm install)");
  if (!ffprobePath || !fs.existsSync(ffprobePath))
    missing.push("ffprobe → run: bun install (or npm install)");

  if (missing.length) {
    console.error("\n❌  Missing binaries:");
    missing.forEach((m) => console.error("    " + m));
    console.error(
      "\n    If already installed, delete node_modules/ and reinstall.\n",
    );
    process.exit(1);
  }

  console.log(`✅  ffmpeg  → ${ffmpegPath}`);
  console.log(`✅  ffprobe → ${ffprobePath}`);

  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);
})();
```

---

## CHANGE 3 — `/stream` route: add dimension + pixel format fixes

**FIND** this block inside the `app.get('/stream', ...)` ffmpeg transcode section:

```js
const cmd = ffmpeg(fp)
  .setStartTime(startSec)
  .addOption("-map", "0:V:0") // FIX 9:  capital V skips cover-art
  .videoCodec("libx264")
  .addOption("-preset", "ultrafast")
  .addOption("-tune", "zerolatency")
  .addOption("-avoid_negative_ts", "make_zero") // FIX 11: fix audio after seek
  .addOption("-max_interleave_delta", "0") // FIX 12: prevent audio packet loss
  .outputOptions(["-movflags", "frag_keyframe+empty_moov+default_base_moof"]);
```

**REPLACE WITH:**

```js
const cmd = ffmpeg(fp)
  .setStartTime(startSec)
  .addOption("-map", "0:V:0")
  .videoCodec("libx264")
  .addOption("-preset", "ultrafast")
  .addOption("-tune", "zerolatency")
  // Fix odd-dimension videos (phone recordings, screen caps, many MKVs)
  // libx264 requires width/height divisible by 2 — this rounds down silently
  .addOption("-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2")
  // Force 8-bit YUV 4:2:0 — required for HDR, 10-bit, and unusual pixel formats
  // Without this, HEVC HDR and NV12 files fail silently
  .addOption("-pix_fmt", "yuv420p")
  .addOption("-avoid_negative_ts", "make_zero")
  .addOption("-max_interleave_delta", "0")
  .outputOptions(["-movflags", "frag_keyframe+empty_moov+default_base_moof"]);
```

---

## CHANGE 4 — `/stream-url` route: same dimension + pixel format fixes

**FIND** this block inside the `app.get('/stream-url', ...)` section:

```js
const cmd = ffmpeg(url)
  .setStartTime(startSec)
  .addOption("-map", "0:V:0")
  .videoCodec("libx264")
  .addOption("-preset", "ultrafast")
  .addOption("-tune", "zerolatency")
  .addOption("-avoid_negative_ts", "make_zero")
  .addOption("-max_interleave_delta", "0")
  .outputOptions(["-movflags", "frag_keyframe+empty_moov+default_base_moof"]);
```

**REPLACE WITH:**

```js
const cmd = ffmpeg(url)
  .setStartTime(startSec)
  .addOption("-map", "0:V:0")
  .videoCodec("libx264")
  .addOption("-preset", "ultrafast")
  .addOption("-tune", "zerolatency")
  .addOption("-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2")
  .addOption("-pix_fmt", "yuv420p")
  .addOption("-avoid_negative_ts", "make_zero")
  .addOption("-max_interleave_delta", "0")
  .outputOptions(["-movflags", "frag_keyframe+empty_moov+default_base_moof"]);
```

---

## CHANGE 5 — `/thumb` route: log errors instead of swallowing them

**FIND:**

```js
    .on('error', () => res.status(500).end())
```

**REPLACE WITH:**

```js
    .on('error', (err) => {
      console.warn(`[thumb] ${path.basename(fp)}: ${err.message.split('\n')[0]}`);
      if (!res.headersSent) res.status(500).end(); else res.end();
    })
```

---

## COMPLETE DIFF SUMMARY

```
package.json:
  - "ffmpeg-static": "^5.2.0"
  + "@ffmpeg-installer/ffmpeg": "^1.1.0"

index.js:
  imports:
  - const ffmpegBin = require('ffmpeg-static');
  + const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  + validateBinaries() — checks both paths exist, logs clear error + exits

  /stream transcode cmd:
  + .addOption('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2')
  + .addOption('-pix_fmt', 'yuv420p')

  /stream-url transcode cmd:
  + .addOption('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2')
  + .addOption('-pix_fmt', 'yuv420p')

  /thumb error handler:
  - .on('error', () => res.status(500).end())
  + .on('error', (err) => { console.warn(...); res.end(); })
```

---

## AFTER MAKING CHANGES

```bash
bun install
# → installs @ffmpeg-installer/ffmpeg (binary bundled, no download script)

node index.js
# → should print:
# ✅  ffmpeg  → D:\...\node_modules\@ffmpeg-installer\win32-x64-7.1\ffmpeg.exe
# ✅  ffprobe → D:\...\node_modules\@ffprobe-installer\win32-x64\ffprobe.exe
# 🎬  VLC Local Player  →  http://localhost:9090
```

---

## TEST CHECKLIST

1. ✅ Server starts without ENOENT error
2. ✅ Startup prints ffmpeg + ffprobe paths
3. ✅ Standard MP4 (H264) plays — direct mode
4. ✅ MKV file plays — ffmpeg transcode
5. ✅ AVI file plays — ffmpeg transcode
6. ✅ Phone video (HEVC .mp4, odd 1080×1919) plays — dimension fix
7. ✅ HDR .mkv (10-bit HEVC) plays — pix_fmt fix
8. ✅ WMV file plays
9. ✅ FLV file plays
10. ✅ URL stream (.m3u8) plays
11. ✅ Thumbnail images load for all formats
12. ✅ Delete node_modules/ + re-run `bun install` → still works (no post-install needed)

```

```
