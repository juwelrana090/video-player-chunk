# Claude Code Prompt — Picture-in-Picture (PiP)

> Paste this entire file into Claude Code.
> Read `index.html` fully before making any change.
> `index.js` does NOT need to change — PiP is 100% a browser API.

---

## WHAT IS BEING ADDED

| Feature                       | Detail                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------- |
| PiP button                    | SVG icon in controls bar, after the fullscreen button                           |
| `togglePip()`                 | Enter/exit PiP, with error handling for unsupported browsers and unloaded video |
| `enterpictureinpicture` event | Button turns orange, OSD shows ON                                               |
| `leavepictureinpicture` event | Button resets, OSD shows OFF                                                    |
| `stopAll()` update            | Exits PiP when video is stopped                                                 |
| Keyboard shortcut             | `P` toggles PiP                                                                 |

**How PiP works in this player:**

- `direct=1` (native seek, H264/MP4): PiP stays open while seeking — zero interruption
- `direct=0` (ffmpeg transcode): seeking reloads the stream, browser auto-exits PiP
  — this is expected browser behaviour, not a bug

---

## STEP 0 — Read files first

```
Read index.html completely before making any change.
Do not touch index.js.
```

---

## CHANGE 1 — Add `isPip` to state

**FIND:**

```js
      autoplay:    true,        // auto-advance to next file when video ends
      currentDir:  '',          // currently browsed directory path
```

**REPLACE WITH:**

```js
      autoplay:    true,        // auto-advance to next file when video ends
      currentDir:  '',          // currently browsed directory path
      isPip:       false,       // picture-in-picture active
```

---

## CHANGE 2 — Add PiP button to HTML controls

**FIND** this exact block (the last two buttons before the closing `</div>`):

```html
            <button id="btnInfo"
              class="btn p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all">&#8505;</button>
            <button id="btnFs"
              class="btn p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all">&#9974;</button>
          </div>
```

**REPLACE WITH** (insert `btnPip` between info and fullscreen):

```html
            <button id="btnInfo"
              class="btn p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all">&#8505;</button>
            <button id="btnPip" title="Picture-in-Picture (P)"
              class="btn p-1.5 rounded-lg hover:bg-white/10 transition-all flex items-center justify-center">
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1.5" y="3.5" width="17" height="12" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
                <rect x="10.5" y="10.5" width="8" height="5" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <button id="btnFs"
              class="btn p-1.5 rounded-lg text-[17px] hover:bg-white/10 transition-all">&#9974;</button>
          </div>
```

> The SVG icon: outer rectangle = main display, filled inner rectangle (bottom-right) = floating PiP window.
> Standard PiP icon recognized by all users.

---

## CHANGE 3 — Add `togglePip()` function

**FIND** this line:

```js
$("vwrap").addEventListener("dblclick", toggleFs);
$("btnFs").addEventListener("click", toggleFs);
function toggleFs() {
  if (!document.fullscreenElement)
    $("vmain")
      .requestFullscreen?.()
      .catch(() => {});
  else document.exitFullscreen?.();
}
```

**REPLACE WITH** (add `togglePip` right after `toggleFs`):

```js
$("vwrap").addEventListener("dblclick", toggleFs);
$("btnFs").addEventListener("click", toggleFs);
function toggleFs() {
  if (!document.fullscreenElement)
    $("vmain")
      .requestFullscreen?.()
      .catch(() => {});
  else document.exitFullscreen?.();
}

/* ── PICTURE-IN-PICTURE ──────────────────────────────────────────────────── */
async function togglePip() {
  if (!S.filePath) {
    showOSD("⚠️ No video loaded");
    return;
  }
  if (!document.pictureInPictureEnabled) {
    showOSD("⚠️ PiP not supported in this browser");
    return;
  }
  try {
    if (document.pictureInPictureElement === vid) {
      await document.exitPictureInPicture();
    } else {
      await vid.requestPictureInPicture();
    }
  } catch (err) {
    if (err.name === "NotAllowedError") {
      // Video must be playing to enter PiP
      showOSD("⚠️ Press play first, then try PiP");
    } else {
      showOSD("⚠️ PiP failed: " + err.message);
      console.warn("[PiP]", err.name, err.message);
    }
  }
}
```

---

## CHANGE 4 — Add PiP video event listeners

**FIND** this line in the video events block:

```js
vid.addEventListener("durationchange", () => {
  if (S.isDirect && isFinite(vid.duration)) {
    S.duration = vid.duration;
    $("timeTot").textContent = fmt(S.duration);
  }
});
```

**REPLACE WITH** (add two PiP events on the next lines):

```js
vid.addEventListener("durationchange", () => {
  if (S.isDirect && isFinite(vid.duration)) {
    S.duration = vid.duration;
    $("timeTot").textContent = fmt(S.duration);
  }
});
vid.addEventListener("enterpictureinpicture", () => {
  S.isPip = true;
  $("btnPip").classList.add("on");
  showOSD("⧉ Picture-in-Picture ON");
});
vid.addEventListener("leavepictureinpicture", () => {
  S.isPip = false;
  $("btnPip").classList.remove("on");
  showOSD("⧉ Picture-in-Picture OFF");
});
```

---

## CHANGE 5 — Update `stopAll()` to exit PiP

**FIND** this exact function:

```js
function stopAll() {
  vid.pause();
  vid.src = "";
  S.filePath = null;
  S.fileName = null;
  S.info = null;
  S.duration = 0;
  S.offset = 0;
  S.isDirect = false;
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

---

## CHANGE 6 — Wire up button listener + keyboard shortcut

**FIND:**

```js
$("btnLoop").addEventListener("click", () => {
  S.looping = !S.looping;
  $("btnLoop").classList.toggle("on", S.looping);
  showOSD(S.looping ? "🔁 Loop ON" : "➡️ Loop OFF");
});
```

**REPLACE WITH** (add `btnPip` listener on next line):

```js
$("btnLoop").addEventListener("click", () => {
  S.looping = !S.looping;
  $("btnLoop").classList.toggle("on", S.looping);
  showOSD(S.looping ? "🔁 Loop ON" : "➡️ Loop OFF");
});
$("btnPip").addEventListener("click", togglePip);
```

**FIND** in the keyboard handler:

```js
        case 'f': case 'F': toggleFs(); break;
```

**REPLACE WITH:**

```js
        case 'f': case 'F': toggleFs(); break;
        case 'p': case 'P': $('btnPip').click(); break;
```

---

## COMPLETE DIFF SUMMARY

```
index.html  const S:
  + isPip: false

index.html  HTML controls (between btnInfo and btnFs):
  + <button id="btnPip"> with SVG PiP icon

index.html  after toggleFs():
  + async function togglePip() { ... }

index.html  video events (after durationchange):
  + vid.addEventListener('enterpictureinpicture', ...)
  + vid.addEventListener('leavepictureinpicture', ...)

index.html  stopAll():
  + document.exitPictureInPicture() guard at top
  + S.isPip = false in reset

index.html  event listeners:
  + $('btnPip').addEventListener('click', togglePip)

index.html  keyboard:
  + case 'p': case 'P': $('btnPip').click(); break;

index.js:   NO CHANGES
```

---

## TEST CHECKLIST

```bash
node index.js   # → http://localhost:9090
```

1. **Button visible** — PiP icon (⊡ rectangle-in-rectangle) appears between ℹ and ⛶
2. **No video loaded** — click PiP → OSD: "⚠️ No video loaded"
3. **Unsupported browser** — if `document.pictureInPictureEnabled` is false → OSD warning (test in Firefox with flag disabled if needed)
4. **Video playing** → click PiP button → video pops out into floating OS window
5. **PiP button turns orange** when active
6. **OSD shows** "⧉ Picture-in-Picture ON"
7. **Press P** on keyboard → same as clicking button
8. **PiP window** has OS-native play/pause controls inside it
9. **Main player controls still work** while in PiP (seek, volume, next track)
10. **Direct mode (H264 MP4)** → seek while in PiP → PiP stays open (no stream reload)
11. **Transcoded mode (MKV/AVI)** → seek while in PiP → PiP closes, re-open manually (expected)
12. **Click PiP button again** → exits PiP → button resets, OSD: "⧉ Picture-in-Picture OFF"
13. **Press S (stop)** while in PiP → PiP closes cleanly before video clears
14. **Auto-next fires** while in PiP → next video starts, PiP continues if same stream mode

```

```
