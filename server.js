/**
 * Real-time TV Remote System — Multi-Room Server (+ uploads with custom name)
 * Local version (saves into ./videos/)
 * - Keeps all existing features
 * - Adds per-room upload with custom filename
 * - Room library + global fallback
 * - HTTP Range streaming
 * - WebSocket bridge per room
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const express = require('express');
const fileUpload = require('express-fileupload');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3002; // default 3001
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DEFAULT_VIDEO_DIR = path.join(ROOT, 'videos');

// Ensure base videos folder exists
try { fs.mkdirSync(DEFAULT_VIDEO_DIR, { recursive: true }); } catch {}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(obj));
}
function serveFile(res, absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(absPath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}
function serveLanding(res, req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] || 'http').replace(/[^a-z]/gi,'') || 'http';
  const html = `
<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TV Remote — Multi-Room</title>
<style>
  :root{--bg:#0e0e12;--card:#14141c;--card2:#191923;--fg:#fff;--muted:#b2b2c2;--border:#242438;--accent:#6ee7ff;--accent2:#7c5cff}
  html,body{height:100%} body{margin:0;background:
    radial-gradient(1200px 600px at 100% -20%, rgba(124,92,255,.18), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(110,231,255,.18), transparent 60%),
    linear-gradient(180deg, #0b0b10, #0e0e12 30%); color:var(--fg);
    font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
  .wrap{min-height:100%;display:grid;place-items:center;padding:32px}
  .card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--border);border-radius:16px;padding:22px;max-width:720px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  h1{margin:0 0 12px 0;font-size:24px}
  .muted{color:var(--muted)}
  .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .input{flex:1;background:#0f0f18;border:1px solid var(--border);color:#d7eafe;padding:12px;border-radius:10px;font-family:ui-monospace,monospace}
  .btn{padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.06);color:#fff;font-weight:700;text-decoration:none}
  .grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
  @media (max-width:720px){.grid{grid-template-columns:1fr}}
  .copyrow{display:flex;gap:10px;align-items:stretch;margin-top:10px}
</style></head>
<body>
<div class="wrap"><div class="card">
  <h1>Real-time TV Remote — Multi-Room</h1>
  <p class="muted small">Create a <strong>Room ID</strong> and share its TV/Remote links.</p>
  <div class="row">
    <input id="room" class="input" placeholder="e.g. cafe-42 or my-home" />
    <button id="go" class="btn">Create / Join</button>
  </div>
  <div id="links" style="display:none;margin-top:16px">
    <div class="grid">
      <a class="btn" id="tvBtn" href="#">📺 Open TV</a>
      <a class="btn" id="remoteBtn" href="#">📱 Open Remote</a>
    </div>
    <div class="copyrow">
      <input class="input" id="tvUrl" readonly/>
      <button class="btn" data-copy="tvUrl">Copy TV Link</button>
    </div>
    <div class="copyrow">
      <input class="input" id="remoteUrl" readonly/>
      <button class="btn" data-copy="remoteUrl">Copy Remote Link</button>
    </div>
    <p class="muted small">Host: ${proto}://${host}</p>
    <p class="muted small">Room videos: <code>./videos/&lt;room&gt;/</code>; Global: <code>./videos/</code>.</p>
  </div>
</div></div>
<script>
(function(){
  const roomInput = document.getElementById('room');
  const goBtn = document.getElementById('go');
  const links = document.getElementById('links');
  const tvUrl = document.getElementById('tvUrl');
  const remoteUrl = document.getElementById('remoteUrl');
  const tvBtn = document.getElementById('tvBtn');
  const remoteBtn = document.getElementById('remoteBtn');
  function slugify(s){ return String(s||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64); }
  function showLinks(room){
    const base = window.location.origin;
    const tv = base + '/' + room + '/tv';
    const remote = base + '/' + room + '/remote';
    tvUrl.value = tv; remoteUrl.value = remote;
    tvBtn.href = tv; remoteBtn.href = remote;
    links.style.display = '';
  }
  goBtn.addEventListener('click', ()=>{
    const room = slugify(roomInput.value);
    if(!room){ roomInput.focus(); return; }
    showLinks(room);
  });
  document.querySelectorAll('[data-copy]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-copy');
      const el = document.getElementById(id);
      try { await navigator.clipboard.writeText(el.value); btn.textContent='Copied ✓'; setTimeout(()=>btn.textContent='Copy ' + (id==='tvUrl'?'TV':'Remote') + ' Link', 900); }
      catch { el.select(); document.execCommand('copy'); }
    });
  });
})();
</script>
</body></html>`;
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(html);
}

function roomFromPathname(pathname) {
  const m = pathname.match(/^\/([^\/]+)(?:\/|$)/);
  if (!m) return null;
  const room = decodeURIComponent(m[1]).trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room)) return null;
  return room.toLowerCase();
}

function listDirVideos(dir, roomKey) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => d.name)
      .filter(name => /\.(mp4|webm|ogg)$/i.test(name))
      .map(name => ({ name, src: `/videos/${encodeURIComponent(roomKey)}/${encodeURIComponent(name)}` }));
  } catch { return []; }
}
function listVideos(room) {
  const out = [];
  const roomPath = path.join(DEFAULT_VIDEO_DIR, room || '');
  if (room && fs.existsSync(roomPath) && fs.statSync(roomPath).isDirectory()) {
    out.push(...listDirVideos(roomPath, room));
  }
  out.push(...listDirVideos(DEFAULT_VIDEO_DIR, '_default'));
  return out;
}

function streamVideo(req, res, absPath) {
  fs.stat(absPath, (err, stats) => {
    if (err || !stats.isFile()) { res.writeHead(404); return res.end('Video not found'); }
    const range = req.headers.range;
    const fileSize = stats.size;
    const contentType = MIME[path.extname(absPath).toLowerCase()] || 'application/octet-stream';

    if (!range) {
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': fileSize, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(absPath).pipe(res);
    }
    if (!range.startsWith('bytes=')) { res.writeHead(416); return res.end('Malformed Range header'); }

    let [startStr, endStr] = range.replace('bytes=','').split('-');
    let start = parseInt(startStr, 10);
    let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

    start = isNaN(start) ? 0 : start;
    end = isNaN(end) ? Math.min(start + 1024 * 1024 - 1, fileSize - 1) : end;
    start = Math.max(0, start);
    end = Math.min(end, fileSize - 1);

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    fs.createReadStream(absPath, { start, end }).pipe(res);
  });
}

/* -------------------- Express (uploads) -------------------- */
const app = express();
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: path.join(ROOT, '.tmp_uploads'),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
}));

function sanitizeBaseName(input) {
  let base = String(input || '').trim();
  base = base.replace(/\.[a-z0-9]{1,10}$/i, '');      // drop extension
  base = base.replace(/[^a-zA-Z0-9 _.\-]/g, '');      // safe chars
  base = base.replace(/\s+/g, ' ').replace(/^[.\s]+/, '').slice(0, 120);
  if (!base) base = 'upload';
  return base.replace(/\s+/g, '-');                   // spaces -> dashes
}
function dedupePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename, i = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${i}${ext}`; i++;
  }
  return candidate;
}

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.post('/:room/api/upload', (req, res) => {
  const room = String(req.params.room || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(room)) return res.status(400).json({ error: 'Invalid room name' });
  if (!req.files || !req.files.file)   return res.status(400).json({ error: 'No file uploaded' });

  const file = req.files.file;
  const origExt = path.extname(file.name).toLowerCase();
  if (!['.mp4', '.webm', '.ogg'].includes(origExt)) {
    return res.status(400).json({ error: 'Only .mp4, .webm, .ogg allowed' });
  }

  const provided = (req.body && req.body.name) ? req.body.name : '';
  const safeBase = sanitizeBaseName(provided || path.basename(file.name, origExt));
  let finalName = `${safeBase}${origExt}`;

  const uploadDir = path.join(DEFAULT_VIDEO_DIR, room);
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch {}
  finalName = dedupePath(uploadDir, finalName);

  const savePath = path.join(uploadDir, finalName);
  file.mv(savePath, (err) => {
    if (err) { console.error('Upload error:', err); return res.status(500).json({ error: 'Failed to save file' }); }
    return res.json({ success: true, file: finalName });
  });
});

/* -------------------- App routes (landing, tv, remote, api, videos) -------------------- */
app.use((req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  const room = roomFromPathname(pathname);

  if (pathname === '/') {
    const idx = path.join(ROOT, 'index.html');
    if (fs.existsSync(idx)) return serveFile(res, idx);
    return serveLanding(res, req);
  }

  if (room && pathname === `/${room}/tv`)     return serveFile(res, path.join(ROOT, 'tv_app.html'));
  if (room && pathname === `/${room}/remote`) return serveFile(res, path.join(ROOT, 'mobile_remote.html'));

  if (room && pathname === `/${room}/api/videos`) {
    return sendJSON(res, 200, { videos: listVideos(room) });
  }
  if (room && pathname === `/${room}/api/video`) {
    const videos = listVideos(room);
    let chosen = null;
    if (query && typeof query.name === 'string') chosen = videos.find(v => v.name === query.name);
    if (!chosen) chosen = videos[0] || null;
    return sendJSON(res, 200, chosen || { title: 'No video found', src: null });
  }

  if (pathname.startsWith('/videos/')) {
    const parts = pathname.split('/').map(decodeURIComponent);
    if (parts.length >= 4) {
      const roomKey = parts[2];
      const filename = parts.slice(3).join('/');
      const safeName = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
      const dir = roomKey === '_default' ? DEFAULT_VIDEO_DIR : path.join(DEFAULT_VIDEO_DIR, roomKey);
      const abs = path.join(dir, safeName);
      return streamVideo(req, res, abs);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

/* -------------------- HTTP + WebSocket -------------------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// room -> { tvs:Set, remotes:Set }
const rooms = new Map();
function getRoomBucket(room) {
  if (!rooms.has(room)) rooms.set(room, { tvs: new Set(), remotes: new Set() });
  return rooms.get(room);
}
function broadcastToRemotes(room, payload) {
  const data = JSON.stringify(payload);
  const bucket = rooms.get(room);
  if (!bucket) return;
  for (const ws of bucket.remotes) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}
function forwardToTVs(room, payload) {
  const data = JSON.stringify(payload);
  const bucket = rooms.get(room);
  if (!bucket) return;
  for (const ws of bucket.tvs) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

wss.on('connection', (ws, req) => {
  const { query } = url.parse(req.url, true);
  const role = String(query.role || '');
  const room = String(query.room || '').toLowerCase();

  if (!room || !/^[a-z0-9_-]{1,64}$/.test(room)) {
    ws.close(1008, 'room required');
    return;
  }

  const bucket = getRoomBucket(room);

  if (role === 'tv') {
    bucket.tvs.add(ws);
    broadcastToRemotes(room, { type: 'status', tvConnected: true });
  } else {
    bucket.remotes.add(ws);
    ws.send(JSON.stringify({ type: 'status', tvConnected: bucket.tvs.size > 0 }));
  }

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (role === 'tv' && msg?.type === 'state') {
      broadcastToRemotes(room, {
        type: 'tv_state',
        paused: !!msg.paused,
        muted: !!msg.muted,
        volume: Number.isFinite(msg.volume) ? msg.volume : undefined,
        rate: Number.isFinite(msg.rate) ? msg.rate : undefined,
        current: msg.current || undefined,
        time: Number.isFinite(msg.time) ? msg.time : undefined,
        duration: Number.isFinite(msg.duration) ? msg.duration : undefined,
      });
      return;
    }
    if (role !== 'tv' && msg?.type === 'command') {
      const allowed = ['play','pause','playpause','stop','seek','seekTo','seek_percent','volume_set','mute','unmute','toggle_mute','rate_set','fullscreen','exit_fullscreen','load'];
      if (allowed.includes(msg.action)) forwardToTVs(room, msg);
      return;
    }
  });

  ws.on('close', () => {
    const bucket = rooms.get(room);
    if (!bucket) return;
    bucket.tvs.delete(ws);
    bucket.remotes.delete(ws);
    if (bucket.tvs.size === 0) broadcastToRemotes(room, { type: 'status', tvConnected: false });
    if (bucket.tvs.size === 0 && bucket.remotes.size === 0) rooms.delete(room);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Open / then create a Room ID, e.g. http://localhost:${PORT}/my-room/tv`);
});
