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
