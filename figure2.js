// Animierte Figur mit festen Knochenlängen.
// Die Erkennung liefert je Bild leicht schwankende Segmentlängen (Kleidung, Unschärfe, Perspektive).
// Hier wird ein starres Modell gebaut: jede Knochenlänge ist konstant (Median), nur die Winkel kommen aus dem Video.

// Reihenfolge wie FIG_JOINTS in analysis.js
const J = { nose: 0, lSh: 1, rSh: 2, lEl: 3, rEl: 4, lWr: 5, rWr: 6, lHip: 7, rHip: 8, lKnee: 9, rKnee: 10, lAnk: 11, rAnk: 12, lHeel: 13, rHeel: 14, lToe: 15, rToe: 16, lEar: 17, rEar: 18 };
const SIDE = {
  L: { sh: J.lSh, el: J.lEl, wr: J.lWr, hip: J.lHip, knee: J.lKnee, ank: J.lAnk, heel: J.lHeel, toe: J.lToe },
  R: { sh: J.rSh, el: J.rEl, wr: J.rWr, hip: J.rHip, knee: J.rKnee, ank: J.rAnk, heel: J.rHeel, toe: J.rToe },
};
const len = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : NaN);
const midp = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a || b);
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
const unit = (a, b) => { const d = len(a, b); return d > 1e-6 ? [(b[0] - a[0]) / d, (b[1] - a[1]) / d] : [0, -1]; };
const add = (p, u, l) => [p[0] + u[0] * l, p[1] + u[1] * l];
const headRef = (f) => (f[J.lEar] || f[J.rEar] ? midp(f[J.lEar], f[J.rEar]) : f[J.nose]);

export function buildRig(stride) {
  const F = stride.frames, L = {};
  const each = (fn) => F.map(fn);
  L.trunk = med(each((f) => len(midp(f[J.lHip], f[J.rHip]), midp(f[J.lSh], f[J.rSh]))));
  // Kopfmitte: Ohren (liegen in der Kopfmitte), sonst Nase. Die Nase liegt vorne/unten – damit „sackt“ der Kopf.
  L.neck = med(each((f) => len(midp(f[J.lSh], f[J.rSh]), headRef(f))));
  for (const s of ['L', 'R']) {
    const S = SIDE[s];
    L['thigh' + s] = med(each((f) => len(f[S.hip], f[S.knee])));
    L['shank' + s] = med(each((f) => len(f[S.knee], f[S.ank])));
    L['foot' + s] = med(each((f) => len(f[S.ank], f[S.toe])));
    L['heel' + s] = med(each((f) => len(f[S.ank], f[S.heel])));
    L['upper' + s] = med(each((f) => len(f[S.sh], f[S.el])));
    L['fore' + s] = med(each((f) => len(f[S.el], f[S.wr])));
  }
  // links/rechts angleichen (gleich lange Beine/Arme), Ausreißer vermeiden
  for (const k of ['thigh', 'shank', 'foot', 'heel', 'upper', 'fore']) { const m = med([L[k + 'L'], L[k + 'R']]); const v = Number.isFinite(L[k + 'L']) && Number.isFinite(L[k + 'R']) ? (L[k + 'L'] + L[k + 'R']) / 2 : m; L[k + 'L'] = L[k + 'R'] = v; }
  if (!Number.isFinite(L.neck)) L.neck = 0.25;
  return L;
}

// starre Pose aus einem Stride-Frame
export function rigPose(f, L) {
  const hipC = midp(f[J.lHip], f[J.rHip]); if (!hipC) return null;
  const shRaw = midp(f[J.lSh], f[J.rSh]);
  const sh = shRaw ? add(hipC, unit(hipC, shRaw), L.trunk) : [hipC[0], hipC[1] + L.trunk];
  // Kopfrichtung: aus Ohren; ohne Ohren überwiegend in Verlängerung des Rumpfs (verhindert Absacken in die Brust)
  const tr = unit(hipC, sh), hr = headRef(f);
  let hd = tr;
  if (hr) { const u = unit(sh, hr); const w = f[J.lEar] || f[J.rEar] ? 0.85 : 0.35; hd = [tr[0] * (1 - w) + u[0] * w, tr[1] * (1 - w) + u[1] * w]; const l = Math.hypot(hd[0], hd[1]) || 1; hd = [hd[0] / l, hd[1] / l]; }
  // Kopf nie hinter/unter die Schulterlinie kippen lassen
  if (hd[1] < 0.35) { hd = [hd[0], 0.35]; const l = Math.hypot(hd[0], hd[1]); hd = [hd[0] / l, hd[1] / l]; }
  const head = add(sh, hd, Math.max(L.neck || 0, 0.2));
  const pose = { hip: hipC, sh, head };
  for (const s of ['L', 'R']) {
    const S = SIDE[s];
    const knee = f[S.knee] ? add(hipC, unit(f[S.hip] || hipC, f[S.knee]), L['thigh' + s]) : null;
    const ank = knee && f[S.ank] ? add(knee, unit(f[S.knee], f[S.ank]), L['shank' + s]) : null;
    const toe = ank && f[S.toe] ? add(ank, unit(f[S.ank], f[S.toe]), L['foot' + s]) : null;
    const heel = ank && f[S.heel] ? add(ank, unit(f[S.ank], f[S.heel]), L['heel' + s]) : null;
    const el = f[S.el] ? add(sh, unit(f[S.sh] || sh, f[S.el]), L['upper' + s]) : null;
    const wr = el && f[S.wr] ? add(el, unit(f[S.el], f[S.wr]), L['fore' + s]) : null;
    pose[s] = { knee, ank, toe, heel, el, wr };
  }
  // Bodenhöhe ausgleichen: tiefster Fußpunkt der Figur soll nie unter den Boden gehen
  return pose;
}

export function stridePoses(stride) {
  const L = buildRig(stride);
  const poses = stride.frames.map((f) => rigPose(f, L));
  // Figur auf den Boden stellen: im Kontakt liegt der tiefste Fußpunkt bei y = 0
  const lows = [];
  poses.forEach((p, i) => { if (!p) return; const t = i / stride.samples; if (stride.contacts.some((c) => t >= c.a && t <= c.b)) lows.push(Math.min(...['L', 'R'].flatMap((s) => [p[s].toe, p[s].heel, p[s].ank].filter(Boolean).map((q) => q[1])))); });
  const off = lows.length ? med(lows) : 0;
  for (const p of poses) if (p) shiftPose(p, -off);
  return { poses, L };
}
function shiftPose(p, dy) {
  for (const k of ['hip', 'sh', 'head']) if (p[k]) p[k] = [p[k][0], p[k][1] + dy];
  for (const s of ['L', 'R']) for (const k of Object.keys(p[s])) if (p[s][k]) p[s][k] = [p[s][k][0], p[s][k][1] + dy];
}

export function contactAtT(stride, t) {
  const c = stride.contacts.find((c) => t >= c.a && t <= c.b);
  return c ? c.side : null;
}

// ---------- Zeichnen ----------
const COLORS = { L: '#e4572e', R: '#2e86de' };
export function drawFigure(ctx, pose, o) {
  if (!pose) return;
  const { scale, ox, oy } = o;
  const P = (p) => [ox + p[0] * scale, oy - p[1] * scale];
  const w = Math.max(3, scale * 0.075);
  const seg = (a, b, col, wd) => { if (!a || !b) return; const A = P(a), B = P(b); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = o.alpha ?? 1;
  const mono = o.color; // einfarbig (Vergleich) oder links/rechts farbig
  const order = o.farSide === 'L' ? ['L', 'R'] : ['R', 'L']; // hintere Seite zuerst
  const limb = (s, far) => {
    const p = pose[s], c = mono || COLORS[s], a = far ? 0.55 : 1;
    ctx.globalAlpha = (o.alpha ?? 1) * a;
    seg(pose.hip, p.knee, c, w * 1.25); seg(p.knee, p.ank, c, w * 1.05);
    seg(p.heel, p.toe, c, w * 0.7); seg(p.ank, p.heel, c, w * 0.7);
    if (o.contact === s && p.toe) { const T = P(p.toe), H = p.heel ? P(p.heel) : T; ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc((T[0] + H[0]) / 2, Math.max(T[1], H[1]) + w * 0.2, w * 0.7, 0, 7); ctx.fill(); }
  };
  const arm = (s, far) => { const p = pose[s], c = mono || COLORS[s]; ctx.globalAlpha = (o.alpha ?? 1) * (far ? 0.55 : 1); seg(pose.sh, p.el, c, w * 0.85); seg(p.el, p.wr, c, w * 0.75); };
  arm(order[0], true); limb(order[0], true);
  ctx.globalAlpha = o.alpha ?? 1;
  const tc = mono || (o.dark ? '#e8e8e8' : '#3a3d42');
  seg(pose.hip, pose.sh, tc, w * 1.9);
  seg(pose.sh, pose.head, tc, w * 0.8);
  if (pose.head) { const H = P(pose.head); ctx.fillStyle = tc; ctx.beginPath(); ctx.arc(H[0], H[1], w * 1.35, 0, 7); ctx.fill(); }
  limb(order[1], false); arm(order[1], false);
  ctx.restore();
}

// Hilfslinien für Standbilder (Bereiche)
export function drawGuides(ctx, pose, o, kind, stanceSide) {
  if (!pose) return;
  const { scale, ox, oy } = o;
  const P = (p) => [ox + p[0] * scale, oy - p[1] * scale];
  const line = (a, b, col, dash = [6, 5], wd = 2) => { if (!a || !b) return; const A = P(a), B = P(b); ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.restore(); };
  const vert = (p, h) => line(p, [p[0], p[1] + h], 'rgba(128,128,128,.8)', [3, 4], 1.5);
  const st = pose[stanceSide] || pose.L;
  if (kind === 'to' && st.toe) { line(st.toe, pose.sh, '#d9482b'); line(pose.hip, pose.sh, '#f0b429', [], 2.5); vert(st.toe, 1.6); }
  if (kind === 'td' && st.ank) { vert(st.ank, 0.9); line(st.ank, st.knee, '#d9482b', [], 3); line([pose.hip[0], 0.02], [st.ank[0], 0.02], '#f0b429', [], 3); vert(pose.hip, 0.2); }
  if (kind === 'arm') { vert(pose.sh, -0.6); }
}

// ---------- Abspieler ----------
// Die Figur läuft wirklich vorwärts (Hüftweg aus dem Video), die gestrichelte Linie zeigt den Weg der Hüfte –
// dort sieht man Flugphase und Landung. Fußabdrücke markieren die Bodenkontakte.
export class FigurePlayer {
  constructor(canvas, opts = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.items = []; this.t = 0; this.speed = 0.25; this.playing = false;
    this.onFrame = opts.onFrame; this.dark = true; this._last = 0; this._loop = this._loop.bind(this);
  }
  set(items) {
    this.items = items.filter((x) => x && x.stride).map((x) => {
      const sp = stridePoses(x.stride), st = x.stride, n = sp.poses.length;
      // Vorwärtsweg: gemessen (feste Kamera) oder aus dem Tempo geschätzt
      let hx = st.hx && st.hx.length === n ? st.hx.slice() : null;
      if (!hx) { const v = st.speed || 0; hx = sp.poses.map((_, i) => v * (i / n) * st.durationMs / 1000); }
      const D = hx[n - 1] + (hx[n - 1] - hx[n - 2] || 0);
      return { ...x, ...sp, hx, D };
    });
    this.draw();
  }
  play() { if (!this.items.length) return; this.playing = true; this._last = performance.now(); requestAnimationFrame(this._loop); }
  pause() { this.playing = false; }
  toggle() { this.playing ? this.pause() : this.play(); return this.playing; }
  seek(t) { this.t = ((t % 1) + 1) % 1; this.draw(); }
  _loop(now) {
    if (!this.playing) return;
    const dur = Math.max(...this.items.map((x) => x.stride.durationMs)) || 450;
    this.t = (this.t + (now - this._last) / dur * this.speed) % 1; this._last = now; this.draw(); requestAnimationFrame(this._loop);
  }
  draw() {
    const { c, ctx } = this, W = c.width, H = c.height; ctx.clearRect(0, 0, W, H);
    if (!this.items.length) return;
    const dark = this.dark, fg = dark ? '#f2f2f7' : '#1c1c1e', mute = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)';
    const D = Math.max(...this.items.map((x) => x.D), 0.5);
    const scale = Math.min((H - 70) / 2.15, (W - 60) / (D + 1.6));
    const groundY = H - 44, ox = 30 + 0.8 * scale;
    const X = (x) => ox + x * scale, Y = (y) => groundY - y * scale;
    // Bahn: Boden und Meter-Markierungen
    ctx.fillStyle = dark ? 'rgba(194,54,43,.22)' : 'rgba(194,54,43,.10)'; ctx.fillRect(0, groundY, W, H - groundY);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,1)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, groundY + 1.5); ctx.lineTo(W, groundY + 1.5); ctx.stroke();
    ctx.fillStyle = dark ? '#8e8e93' : '#8e8e93'; ctx.font = '600 12px ui-rounded, system-ui'; ctx.textAlign = 'center';
    for (let m = 0; m <= Math.ceil(D + 1); m++) { const x = X(m - 0.5); if (x < 10 || x > W - 10) continue; ctx.fillStyle = mute; ctx.fillRect(x - 1, groundY + 6, 2, 10); ctx.fillStyle = '#8e8e93'; ctx.fillText(`${m} m`, x, groundY + 32); }
    ctx.textAlign = 'left';
    const n0 = this.items[0].poses.length;
    this.items.forEach((it, idx) => {
      const n = it.poses.length, col = it.color || null;
      const at = (t) => { const f = t * n, i0 = Math.min(n - 1, Math.floor(f)), i1 = Math.min(n - 1, i0 + 1), a = f - Math.floor(f); return { pose: lerpPose(it.poses[i0], it.poses[i1], a), hx: it.hx[i0] + (it.hx[i1] - it.hx[i0]) * a }; };
      const place = (pose, hx) => { if (!pose) return null; const sh = (p) => (p ? [p[0] + hx, p[1]] : p); const out = { hip: sh(pose.hip), sh: sh(pose.sh), head: sh(pose.head) }; for (const s of ['L', 'R']) { out[s] = {}; for (const k of Object.keys(pose[s])) out[s][k] = sh(pose[s][k]); } return out; };
      // Weg der Hüfte (ganzer Doppelschritt)
      ctx.save(); ctx.strokeStyle = col || (dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.28)'); ctx.globalAlpha = col ? 0.5 : 1; ctx.setLineDash([5, 6]); ctx.lineWidth = 2; ctx.beginPath();
      it.poses.forEach((p, i) => { if (!p) return; const x = X(p.hip[0] + it.hx[i]), y = Y(p.hip[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.restore();
      // Fußabdrücke der Kontakte
      for (const ct of it.stride.contacts) {
        const k = Math.min(n - 1, Math.round(((ct.a + ct.b) / 2) * n)), p = it.poses[k]; if (!p) continue;
        const f = p[ct.side]; const x0 = f.heel ? f.heel[0] : f.ank[0], x1 = f.toe ? f.toe[0] : x0 + 0.2;
        ctx.fillStyle = col || (ct.side === 'L' ? '#E4572E' : '#2E86DE'); ctx.globalAlpha = 0.85;
        const xa = X(Math.min(x0, x1) + it.hx[k]), xb = X(Math.max(x0, x1) + it.hx[k]); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(xa, groundY - 3, Math.max(8, xb - xa), 6, 3) : ctx.rect(xa, groundY - 3, Math.max(8, xb - xa), 6); ctx.fill(); ctx.globalAlpha = 1;
      }
      // Bewegungsspur (frühere Positionen, blass)
      if (this.items.length === 1) for (let g = 1; g <= 4; g++) { const tg = this.t - g * 0.09; if (tg < 0) break; const q = at(tg); drawFigure(ctx, place(q.pose, q.hx), { scale, ox, oy: groundY, alpha: 0.10 + 0.04 * (4 - g), color: dark ? '#ffffff' : '#000000', dark, farSide: 'R' }); }
      const cur = at(this.t);
      drawFigure(ctx, place(cur.pose, cur.hx), { scale, ox, oy: groundY, color: col, alpha: this.items.length > 1 ? 0.9 : 1, contact: contactAtT(it.stride, this.t), dark, farSide: 'R' });
    });
    // Statusmarke
    const it = this.items[0], ct = contactAtT(it.stride, this.t);
    const txt = ct ? `Bodenkontakt ${ct === 'L' ? 'links' : 'rechts'}` : 'Flugphase';
    ctx.font = '600 15px -apple-system, system-ui'; const w = ctx.measureText(txt).width + 26;
    ctx.fillStyle = ct ? 'rgba(46,158,98,.16)' : (dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.06)'); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(16, 14, w, 32, 16) : ctx.rect(16, 14, w, 32); ctx.fill();
    ctx.fillStyle = ct ? '#2E9E62' : fg; ctx.fillText(txt, 29, 35);
    if (this.onFrame) this.onFrame(this.t, this.items);
  }
}
export function lerpPose(p, q, a) {
  if (!p || !q) return p || q;
  const L = (u, v) => (u && v ? [u[0] + (v[0] - u[0]) * a, u[1] + (v[1] - u[1]) * a] : u || v);
  const out = { hip: L(p.hip, q.hip), sh: L(p.sh, q.sh), head: L(p.head, q.head) };
  for (const s of ['L', 'R']) { out[s] = {}; for (const k of Object.keys(p[s])) out[s][k] = L(p[s][k], q[s][k]); }
  return out;
}

// Standbild in ein Canvas (z. B. für die Bereiche)
export function drawStill(canvas, stride, kind) {
  const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height; ctx.clearRect(0, 0, W, H);
  if (!stride) return;
  const { poses } = stridePoses(stride);
  const c0 = stride.contacts[0];
  let idx = 0;
  if (kind === 'to' && c0) idx = Math.min(poses.length - 1, Math.round(c0.b * stride.samples));
  else if (kind === 'arm') idx = Math.round(((c0 ? c0.b : 0.25) + (stride.contacts[1] ? stride.contacts[1].a : 0.5)) / 2 * stride.samples) % poses.length;
  const pose = poses[idx]; if (!pose) return;
  const dark = true;
  const scale = H / 2.2, oy = H - 14, ox = W / 2;
  ctx.strokeStyle = dark ? '#555' : '#c9c6bf'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, oy + 2); ctx.lineTo(W, oy + 2); ctx.stroke();
  drawFigure(ctx, pose, { scale, ox, oy, contact: c0 && (kind === 'td' || kind === 'to') ? c0.side : null, dark, farSide: 'R' });
  drawGuides(ctx, pose, { scale, ox, oy }, kind, c0 ? c0.side : 'L');
}
