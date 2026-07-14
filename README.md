# 🎬 VLC-Style Video Player

A browser-based video player with **all-format support** and **multiple audio track switching** — built with Node.js, Express, and ffmpeg.

## Setup

```bash
npm install
npm start
# → http://localhost:8000
```

Use `npm run dev` for auto-reload during development.

## Features

| Feature | Details |
|---|---|
| **All video formats** | MP4, MKV, AVI, MOV, WebM, FLV, TS, WMV, RMVB, 3GP, MPEG & more |
| **Audio track switching** | Switch between any audio track at runtime (like VLC) |
| **Drag & drop upload** | Drop any video file onto the sidebar |
| **Smart progress bar** | Seek by clicking, hover for time preview |
| **Volume control** | Slider + mute button |
| **Playback speed** | 0.25× to 3× |
| **Loop mode** | Toggle repeat |
| **Fullscreen** | Click button or double-click video |
| **Media info panel** | Codec, resolution, FPS, bitrate, track count |
| **OSD notifications** | On-screen display for all actions |
| **Thumbnails** | Auto-generated previews in sidebar |

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` / `K` | Play / Pause |
| `←` / `→` | Seek ±10 seconds |
| `↑` / `↓` | Volume ±10% |
| `M` | Mute |
| `F` | Fullscreen |
| `L` | Toggle loop |
| `I` | Media info panel |
| `S` | Stop |
| `Esc` | Exit fullscreen |

## How audio switching works

Every video is streamed through ffmpeg on-the-fly (fragmented MP4).
When you switch tracks, the server restarts the ffmpeg process with the
new `-map 0:a:N` flag from the current timestamp. No re-encoding of
video — just audio remapping. Seeking works the same way.

## Requirements

- **Node.js 16+**
- No system ffmpeg needed — bundled via `ffmpeg-static` npm package
