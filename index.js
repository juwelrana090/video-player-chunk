const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const ffmpeg     = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeBin = require('@ffprobe-installer/ffprobe').path;

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

const { Transform } = require('stream');

const CHUNK_SIZE = 10 ** 6; // 1 MB — fixed chunk size (matches original chunking logic)

function make1MBChunker() {
  const CHUNK = CHUNK_SIZE; // use shared constant
  let buf = Buffer.alloc(0);
  return new Transform({
    transform(data, _, cb) {
      buf = Buffer.concat([buf, data]);
      while (buf.length >= CHUNK) {
        this.push(buf.subarray(0, CHUNK));
        buf = buf.subarray(CHUNK);
      }
      cb();
    },
    flush(cb) {
      if (buf.length > 0) this.push(buf);
      cb();
    }
  });
}

const app  = express();
const PORT = process.env.PORT || 9090;

const VIDEO_EXTS = new Set([
  '.mp4','.mkv','.avi','.mov','.webm','.flv','.ts','.m2ts',
  '.m4v','.3gp','.mpg','.mpeg','.wmv','.rmvb','.ogv','.vob',
  '.asf','.divx','.mxf','.f4v','.rm'
]);

app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ── GET /homedir ─────────────────────────────────────────────────────────────
   Returns OS home directory for frontend quickPath shortcuts
*/
app.get('/homedir', (req, res) => {
  res.json({ home: require('os').homedir() });
});

/* ── POST /scan ──────────────────────────────────────────────────────────────
   Scan a local folder. Returns all video files found.
   Body: { dir: "C:/Users/Juwel/Videos" }
*/
app.post('/scan', (req, res) => {
  const dir = (req.body?.dir || '').trim();
  if (!dir) return res.status(400).json({ error: 'dir is required' });
  try {
    if (!fs.statSync(dir).isDirectory())
      return res.status(400).json({ error: 'Not a directory' });
  } catch {
    return res.status(404).json({ error: 'Directory not found: ' + dir });
  }
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /info?path=... ──────────────────────────────────────────────────── */
app.get('/info', (req, res) => {
  const fp = req.query.path;
  if (!fp) return res.status(400).json({ error: 'path required' });
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });

  ffmpeg.ffprobe(fp, (err, meta) => {
    if (err) return res.status(500).json({ error: err.message });
    const audio = meta.streams.filter(s => s.codec_type === 'audio').map((s, i) => {
      const lang = s.tags?.language, title = s.tags?.title;
      return {
        index: i, codec: s.codec_name, channels: s.channels,
        channelLayout: s.channel_layout || '',
        sampleRate: parseInt(s.sample_rate) || 0,
        language: lang || 'und', title: title || null,
        label: title || (lang && lang !== 'und' ? lang.toUpperCase() : `Track ${i + 1}`),
        isDefault: s.disposition?.default === 1
      };
    });
    const video = meta.streams.filter(s => s.codec_type === 'video').map(s => {
      let fps = 0;
      try { const [n, d] = s.r_frame_rate.split('/'); fps = parseFloat(n) / parseFloat(d); } catch {}
      return { codec: s.codec_name, width: s.width, height: s.height,
               fps: Math.round(fps * 100) / 100, bitrate: parseInt(s.bit_rate) || 0 };
    });
    const subtitles = meta.streams.filter(s => s.codec_type === 'subtitle').map((s, i) => ({
      index: i, codec: s.codec_name, language: s.tags?.language || 'und',
      label: s.tags?.title || (s.tags?.language && s.tags.language !== 'und'
             ? s.tags.language.toUpperCase() : `Sub ${i + 1}`)
    }));
    const st = fs.statSync(fp);
    res.json({
      format: {
        name: meta.format.format_long_name || meta.format.format_name,
        duration: parseFloat(meta.format.duration) || 0,
        size: st.size, bitrate: parseInt(meta.format.bit_rate) || 0,
        title: meta.format.tags?.title || null
      },
      video, audio, subtitles
    });
  });
});

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

/* ── GET /thumb?path=... ─────────────────────────────────────────────────── */
app.get('/thumb', (req, res) => {
  const fp = req.query.path;
  if (!fp || !fs.existsSync(fp)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  ffmpeg(fp).setStartTime(4).frames(1).size('320x?')
    .videoCodec('mjpeg').format('image2').outputOptions(['-q:v', '5'])
    .on('error', (err) => {
      console.warn(`[thumb] ${path.basename(fp)}: ${err.message.split('\n')[0]}`);
      if (!res.headersSent) res.status(500).end(); else res.end();
    })
    .pipe(res, { end: true });
});

/* ── GET /stream?path=...&audio=0&start=0&direct=1 ───────────────────────
   direct=1 → Range-header serve (MP4/H264 only, native browser seek, zero CPU)
   direct=0 → ffmpeg transcode (all formats + audio track switching)
*/
const activeStreams = new Map();
let   streamSeq    = 0;

app.get('/stream', (req, res) => {
  const fp       = req.query.path;
  const audioIdx = Math.max(-1, parseInt(req.query.audio  ?? '0', 10));
  const startSec = Math.max(0,  parseFloat(req.query.start ?? '0'));
  const direct   = req.query.direct === '1';

  if (!fp) return res.status(400).end();
  if (!fs.existsSync(fp)) return res.status(404).end();

  // ── DIRECT SERVE: Range headers, zero CPU, native seek ───────────────────
  if (direct) {
    const stat     = fs.statSync(fp);
    const fileSize = stat.size;
    const range    = req.headers.range;
    const mime     = path.extname(fp).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';

    if (range) {
      const start = parseInt(range.replace(/bytes=/, '').split('-')[0], 10); // ← fixed parse
      const end = Math.min(start + CHUNK_SIZE, fileSize - 1); // ← CHUNK_SIZE cap
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   mime,
      });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type':   mime,
        'Accept-Ranges':  'bytes',
      });
      fs.createReadStream(fp).pipe(res);
    }
    return;
  }

  // ── FFMPEG TRANSCODE: all formats + audio track switching ─────────────────
  const sid = ++streamSeq;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const cmd = ffmpeg(fp)
    .setStartTime(startSec)
    .addOption('-map', '0:V:0')
    .videoCodec('libx264')
    .addOption('-preset', 'ultrafast')
    .addOption('-tune', 'zerolatency')
    // Fix odd-dimension videos (phone recordings, screen caps, many MKVs)
    // libx264 requires width/height divisible by 2 — this rounds down silently
    .addOption('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2')
    // Force 8-bit YUV 4:2:0 — required for HDR, 10-bit, and unusual pixel formats
    // Without this, HEVC HDR and NV12 files fail silently
    .addOption('-pix_fmt', 'yuv420p')
    .addOption('-avoid_negative_ts', 'make_zero')
    .addOption('-max_interleave_delta', '0')
    .outputOptions(['-movflags', 'frag_keyframe+empty_moov+default_base_moof']);

  if (audioIdx >= 0) {
    cmd.addOption('-map', `0:a:${audioIdx}`)
       .audioCodec('aac')
       .addOption('-b:a', '192k')
       .addOption('-ac',  '2')
       .addOption('-ar',  '48000');    // FIX 10: normalized 48kHz — browser standard
  } else {
    cmd.addOption('-an');               // FIX 13: -an instead of .noAudio()
  }

  cmd.format('mp4')
    .on('start', cl => console.log(`[#${sid}] ${cl.slice(0, 250)}`))
    .on('error', (err, _o, stderr) => {            // FIX 14: log stderr
      if (err.message?.includes('SIGKILL')) return;
      console.error(`[#${sid}] Error: ${err.message}`);
      if (stderr) console.error(`[#${sid}] stderr:\n${stderr.slice(-500)}`);
      if (!res.headersSent) res.status(500).end(); else res.end();
      activeStreams.delete(sid);
    })
    .on('end', () => activeStreams.delete(sid));

  const chunker = make1MBChunker();
  activeStreams.set(sid, cmd);
  req.on('close', () => {
    try { cmd.kill('SIGKILL'); } catch {}
    chunker.destroy();
    activeStreams.delete(sid);
  });
  cmd.pipe(chunker).pipe(res);
});

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
    .addOption("-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2")
    .addOption("-pix_fmt", "yuv420p")
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

['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => {
  activeStreams.forEach(c => { try { c.kill('SIGKILL'); } catch {} });
  process.exit(0);
}));

app.listen(PORT, () => {
  console.log(`\n🎬  VLC Local Player  →  http://localhost:${PORT}\n`);
});
