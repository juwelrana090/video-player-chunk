/**
 * VLC-Style Video Player – Backend
 * Supports all video formats via ffmpeg transcoding.
 * Multiple audio tracks switchable at runtime.
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const ffmpeg   = require('fluent-ffmpeg');
const ffmpegBin = require('ffmpeg-static');
const ffprobeBin = require('@ffprobe-installer/ffprobe').path;

// ── Configure bundled ffmpeg / ffprobe ───────────────────────────────────────
ffmpeg.setFfmpegPath(ffmpegBin);
ffmpeg.setFfprobePath(ffprobeBin);

const app        = express();
const PORT       = process.env.PORT || 8000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Supported video extensions ───────────────────────────────────────────────
const VIDEO_EXTS = new Set([
  '.mp4','.mkv','.avi','.mov','.webm','.flv','.ts','.m2ts','.mts',
  '.m4v','.3gp','.3g2','.mpg','.mpeg','.wmv','.rmvb','.ogv',
  '.vob','.asf','.divx','.xvid','.dv','.mxf','.f4v','.rm'
]);

// ── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename   : (_, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, safe);
  }
});

const uploader = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
  fileFilter(_, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, VIDEO_EXTS.has(ext) || file.mimetype.startsWith('video/'));
  }
});

// ── Static + JSON ────────────────────────────────────────────────────────────
app.use(express.static(__dirname));
app.use(express.json());

// ── GET / ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'index.html')));

// ── GET /files ───────────────────────────────────────────────────────────────
app.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR)
      .filter(f => !f.startsWith('.') && VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .map(f => {
        const st = fs.statSync(path.join(UPLOAD_DIR, f));
        return { name: f, size: st.size, modified: st.mtime.getTime() };
      })
      .sort((a, b) => b.modified - a.modified);
    res.json(files);
  } catch { res.json([]); }
});

// ── POST /upload ─────────────────────────────────────────────────────────────
app.post('/upload', (req, res) => {
  uploader.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, name: req.file.filename, size: req.file.size });
  });
});

// ── DELETE /files/:name ──────────────────────────────────────────────────────
app.delete('/files/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Delete failed' }); }
});

// ── GET /info/:name ──────────────────────────────────────────────────────────
app.get('/info/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });

  ffmpeg.ffprobe(fp, (err, meta) => {
    if (err) return res.status(500).json({ error: err.message });

    const audio = meta.streams
      .filter(s => s.codec_type === 'audio')
      .map((s, i) => {
        const lang  = s.tags?.language;
        const title = s.tags?.title;
        const ch    = s.channels;
        return {
          index         : i,
          codec         : s.codec_name,
          channels      : ch,
          channelLayout : s.channel_layout || '',
          sampleRate    : parseInt(s.sample_rate) || 0,
          language      : lang || 'und',
          title         : title || null,
          label         : title || (lang && lang !== 'und' ? lang.toUpperCase() : `Track ${i + 1}`),
          isDefault     : s.disposition?.default === 1
        };
      });

    const video = meta.streams
      .filter(s => s.codec_type === 'video')
      .map(s => {
        let fps = 0;
        try { const [n, d] = s.r_frame_rate.split('/'); fps = parseFloat(n) / parseFloat(d); } catch {}
        return {
          codec       : s.codec_name,
          width       : s.width,
          height      : s.height,
          fps         : Math.round(fps * 100) / 100,
          bitrate     : parseInt(s.bit_rate) || 0,
          pixelFormat : s.pix_fmt
        };
      });

    const subtitles = meta.streams
      .filter(s => s.codec_type === 'subtitle')
      .map((s, i) => ({
        index   : i,
        codec   : s.codec_name,
        language: s.tags?.language || 'und',
        label   : s.tags?.title || (s.tags?.language && s.tags.language !== 'und'
                    ? s.tags.language.toUpperCase() : `Sub ${i + 1}`)
      }));

    const st = fs.statSync(fp);
    res.json({
      format: {
        name    : meta.format.format_long_name || meta.format.format_name,
        duration: parseFloat(meta.format.duration) || 0,
        size    : st.size,
        bitrate : parseInt(meta.format.bit_rate) || 0,
        title   : meta.format.tags?.title || null
      },
      video, audio, subtitles
    });
  });
});

// ── GET /thumbnail/:name ─────────────────────────────────────────────────────
app.get('/thumbnail/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).end();

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  ffmpeg(fp)
    .setStartTime(4)
    .frames(1)
    .size('320x?')
    .videoCodec('mjpeg')
    .format('image2')
    .outputOptions(['-q:v', '5'])
    .on('error', () => res.status(500).end())
    .pipe(res, { end: true });
});

// ── Active streams tracker ───────────────────────────────────────────────────
const activeStreams = new Map();
let streamSeq = 0;

// ── GET /stream/:name ────────────────────────────────────────────────────────
app.get('/stream/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).end();

  const audioIdx = Math.max(-1, parseInt(req.query.audio ?? '0', 10));
  const startSec = Math.max(0, parseFloat(req.query.start ?? '0'));
  const sid      = ++streamSeq;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const cmd = ffmpeg(fp)
    .setStartTime(startSec)
    .addOption('-map', '0:v:0')
    .videoCodec('libx264')
    .addOption('-preset', 'ultrafast')
    .addOption('-tune', 'zerolatency')
    .outputOptions(['-movflags', 'frag_keyframe+empty_moov+default_base_moof']);

  if (audioIdx >= 0) {
    cmd.addOption('-map', `0:a:${audioIdx}`)
       .audioCodec('aac')
       .addOption('-b:a', '192k')
       .addOption('-ac', '2');
  } else {
    cmd.noAudio();
  }

  cmd.format('mp4')
    .on('start', cl => console.log(`[#${sid}] ${cl.slice(0, 180)}`))
    .on('error', err => {
      if (err.message?.includes('SIGKILL')) return;
      console.error(`[#${sid}] Error:`, err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
      activeStreams.delete(sid);
    })
    .on('end', () => activeStreams.delete(sid));

  activeStreams.set(sid, cmd);

  req.on('close', () => {
    try { cmd.kill('SIGKILL'); } catch {}
    activeStreams.delete(sid);
  });

  cmd.pipe(res, { end: true });
});

// ── POST /browse ─────────────────────────────────────────────────────────────
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

// ── GET /local-info ───────────────────────────────────────────────────────────
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

// ── GET /local-thumb ─────────────────────────────────────────────────────────
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

// ── GET /local-stream ────────────────────────────────────────────────────────
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

// ── Graceful shutdown ────────────────────────────────────────────────────────
['SIGINT','SIGTERM'].forEach(sig => process.on(sig, () => {
  console.log('\nShutting down...');
  activeStreams.forEach(c => { try { c.kill('SIGKILL'); } catch {} });
  process.exit(0);
}));

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬  VLC-Style Video Player`);
  console.log(`🌐  http://localhost:${PORT}`);
  console.log(`📂  Uploads → ${UPLOAD_DIR}\n`);
});
