// Sprint-Analyse – reine Auswertungslogik (ohne DOM), damit sie testbar ist.
// Eingabe: Landmark-Serie aus MediaPipe Pose (33 Punkte, normalisiert 0..1).

export const LM = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};
const SIDES = {
  L: { sh: LM.lSh, el: LM.lEl, wr: LM.lWr, hip: LM.lHip, knee: LM.lKnee, ank: LM.lAnk, heel: LM.lHeel, toe: LM.lToe },
  R: { sh: LM.rSh, el: LM.rEl, wr: LM.rWr, hip: LM.rHip, knee: LM.rKnee, ank: LM.rAnk, heel: LM.rHeel, toe: LM.rToe },
};

// ---------- kleine Mathe-Helfer ----------
// Höhe (Anteil der Toleranz über dem Boden), bei der Aufsetzen/Abdruck zwischen zwei Bildern interpoliert wird
const LVL = 0.2;
const deg = (r) => (r * 180) / Math.PI;
export function median(a) {
  const v = a.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export function quantile(a, q) {
  const v = a.filter((x) => Number.isFinite(x)).sort((p, r) => p - r);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
const mean = (a) => {
  const v = a.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
// Winkel am Punkt b (Grad, 0..180)
export function jointAngle(a, b, c) {
  const v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))));
}
// Winkel eines Segments (von p nach q) zur Senkrechten nach unten; positiv = q liegt in Laufrichtung vor p
const segFromDown = (p, q, dir) => deg(Math.atan2(dir * (q[0] - p[0]), q[1] - p[1]));
// Winkel eines Segments (von p nach q) zur Senkrechten nach oben; positiv = nach vorne geneigt
const segFromUp = (p, q, dir) => deg(Math.atan2(dir * (q[0] - p[0]), -(q[1] - p[1])));

// ---------- Vorverarbeitung: Bewegungsmodell mit Vorhersage ----------
// Idee: echte Bewegungen sind flüssig. Ein Kalman-Filter sagt für jedes Bild voraus, wo ein Punkt sein müsste
// (Position + Geschwindigkeit), und vergleicht mit der Messung. Messungen, die physikalisch nicht passen
// (Sprung über viele cm in 1/240 s), werden verworfen; Lücken werden mit der Vorhersage gefüllt.
// Ein Rückwärtsdurchlauf (RTS-Glätter) macht das Ergebnis verzögerungsfrei.
// Wichtig: Der Fuß stoppt beim Aufsetzen wirklich abrupt – deshalb dürfen Füße viel stärker beschleunigen
// als Hüfte oder Schultern, sonst würde die Glättung die Kontaktzeit verfälschen.

// erlaubte Beschleunigung (Standardabweichung) je Körperpunkt in m/s²
const ACCEL = (() => {
  const a = new Array(33).fill(150);
  for (const k of [11, 12, 23, 24, 0]) a[k] = 60;          // Rumpf: träge
  for (const k of [13, 14, 25, 26]) a[k] = 300;             // Ellbogen, Knie
  for (const k of [15, 16]) a[k] = 400;                     // Handgelenke
  for (const k of [27, 28, 29, 30, 31, 32]) a[k] = 1500;    // Füße: Aufprall ist echt -> kaum glätten
  return a;
})();
const LEG_PAIRS = [[25, 26], [27, 28], [29, 30], [31, 32]];
const ARM_PAIRS = [[13, 14], [15, 16]];

function rawPixels(frames, W, H) {
  const n = frames.length, P = [], V = [];
  for (let k = 0; k < 33; k++) {
    const arr = new Array(n).fill(null), vis = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      if (f && f.lm && f.lm[k]) {
        const v = f.lm[k][2] ?? 1;
        if (v > 0.2) { arr[i] = [f.lm[k][0] * W, f.lm[k][1] * H]; vis[i] = v; }
      }
    }
    P.push(arr); V.push(vis);
  }
  return { P, V };
}

// Erkennt, wenn die Erkennung linkes und rechtes Bein (oder Arm) vertauscht – im Seitenprofil häufig.
// Vergleicht die Messung mit der Vorhersage aus den letzten zwei Bildern.
function fixSwaps(P, V, n, scale, flags) {
  let swaps = 0;
  for (const group of [LEG_PAIRS, ARM_PAIRS]) {
    for (let i = 2; i < n; i++) {
      let same = 0, swapped = 0, ok = true;
      for (const [l, r] of group) {
        const pl = predictCV(P[l], i), pr = predictCV(P[r], i), ml = P[l][i], mr = P[r][i];
        if (!pl || !pr || !ml || !mr) { ok = false; break; }
        same += dist(ml, pl) + dist(mr, pr);
        swapped += dist(ml, pr) + dist(mr, pl);
      }
      if (!ok) continue;
      if (swapped < 0.5 * same && same > 0.15 * scale * group.length) {
        for (const [l, r] of group) {
          [P[l][i], P[r][i]] = [P[r][i], P[l][i]];
          [V[l][i], V[r][i]] = [V[r][i], V[l][i]];
        }
        swaps++; if (flags) flags[i]++;
      }
    }
  }
  return swaps;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Ausreißer = Punkt springt weg und im nächsten Bild wieder zurück (1–2 Bilder lang).
// Ein echtes Abbremsen (z. B. Fuß setzt auf) springt nicht zurück und bleibt deshalb erhalten.
function removeSpikes(P, n, thr, flags, wMax = 2) {
  let removed = 0;
  for (let k = 11; k < 33; k++) {
    const a = P[k];
    // Auch längere Aussetzer (bis ~45 ms): Ein Punkt, der weit wegspringt und kurz darauf wieder dort ist, wo er vorher war,
    // war falsch erkannt (z. B. verdecktes Bein aufs andere gelegt) – so schnell hin und zurück geht kein Körperteil.
    for (let w = 1; w <= wMax; w++) {
      const need = w <= 2 ? thr : 2.5 * thr;
      for (let i = 1; i + w < n; i++) {
        const prev = a[i - 1], next = a[i + w - 1 + 1];
        if (!prev || !next || dist(prev, next) > thr * (w + 1)) continue; // Nachbarn müssen zueinander passen
        let spike = true, seen = 0;
        for (let j = i; j < i + w; j++) {
          if (!a[j]) { if (w <= 2) { spike = false; break; } continue; } // in längeren Aussetzern dürfen schon verworfene Bilder liegen
          seen++;
          const t = (j - i + 1) / (w + 1);
          const interp = [prev[0] + (next[0] - prev[0]) * t, prev[1] + (next[1] - prev[1]) * t];
          if (dist(a[j], interp) < need) { spike = false; break; }
        }
        if (spike && seen) { for (let j = i; j < i + w; j++) { if (!a[j]) continue; a[j] = null; if (flags) flags[j]++; removed++; } }
      }
    }
  }
  return removed;
}
function predictCV(arr, i) {
  const a = arr[i - 1], b = arr[i - 2];
  if (!a) return null;
  if (!b) return a;
  return [2 * a[0] - b[0], 2 * a[1] - b[1]];
}

// Kalman-Filter (konstante Geschwindigkeit) + RTS-Glätter für eine Koordinate.
// z: Messungen (null = fehlt), r: Messvarianz je Bild, q: Prozessrauschen (Beschleunigungsvarianz, px/Bild²)
export function kalmanRTS(z, r, q, maxGap) {
  const n = z.length;
  const xs = new Array(n), Ps = new Array(n), xp = new Array(n), Pp = new Array(n), used = new Array(n).fill(false);
  let x = null, P = null, gap = Infinity;
  // Prozessrauschen-Matrix für dt = 1
  const Q = [q / 4, q / 2, q / 2, q];
  for (let i = 0; i < n; i++) {
    if (x) { // Vorhersage
      x = [x[0] + x[1], x[1]];
      P = [P[0] + P[1] + P[2] + P[3] + Q[0], P[1] + P[3] + Q[1], P[2] + P[3] + Q[2], P[3] + Q[3]];
    }
    xp[i] = x && [...x]; Pp[i] = P && [...P];
    if (z[i] != null) {
      if (!x) { x = [z[i], 0]; P = [r[i], 0, 0, 1e4]; }
      else {
        const S = P[0] + r[i], innov = z[i] - x[0];
        const K0 = P[0] / S, K1 = P[2] / S;
        x = [x[0] + K0 * innov, x[1] + K1 * innov];
        P = [(1 - K0) * P[0], (1 - K0) * P[1], P[2] - K1 * P[0], P[3] - K1 * P[1]];
      }
      used[i] = true; gap = 0;
    } else gap++;
    xs[i] = x && [...x]; Ps[i] = P && [...P];
    if (gap > maxGap) { x = null; P = null; } // zu lange Lücke: nicht weiter raten
  }
  // RTS-Rückwärtsdurchlauf
  const out = xs.map((v) => (v ? v[0] : null));
  let xn = xs[n - 1], Pn = Ps[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    if (!xs[i] || !xp[i + 1] || !xn) { xn = xs[i]; Pn = Ps[i]; out[i] = xs[i] ? xs[i][0] : null; continue; }
    const Pf = Ps[i], Ppr = Pp[i + 1];
    // F = [[1,1],[0,1]];  C = Pf F^T Ppr^-1
    const PfFt = [Pf[0] + Pf[1], Pf[1], Pf[2] + Pf[3], Pf[3]];
    const det = Ppr[0] * Ppr[3] - Ppr[1] * Ppr[2];
    if (Math.abs(det) < 1e-12) { xn = xs[i]; Pn = Ps[i]; out[i] = xs[i][0]; continue; }
    const inv = [Ppr[3] / det, -Ppr[1] / det, -Ppr[2] / det, Ppr[0] / det];
    const C = [PfFt[0] * inv[0] + PfFt[1] * inv[2], PfFt[0] * inv[1] + PfFt[1] * inv[3], PfFt[2] * inv[0] + PfFt[3] * inv[2], PfFt[2] * inv[1] + PfFt[3] * inv[3]];
    const d0 = xn[0] - xp[i + 1][0], d1 = xn[1] - xp[i + 1][1];
    const x0 = xs[i][0] + C[0] * d0 + C[1] * d1, x1 = xs[i][1] + C[2] * d0 + C[3] * d1;
    // Kovarianz wird für die Glättung der Position nicht weiter gebraucht -> vereinfacht übernehmen
    xn = [x0, x1]; Pn = Pf; out[i] = x0;
  }
  return { out, used };
}

// frames -> geglättete Pixel-Koordinaten P[k][i] = [x,y] | null, plus Statistik
// Kamera-Neigung ausgleichen: alle Punkte um die Bildmitte drehen, sodass Bahnlinie/Boden waagrecht liegt
export function rotatePt(p, tilt, W, H, inverse = false) {
  if (!p || !tilt) return p;
  const a = inverse ? -tilt : tilt, c = Math.cos(a), s = Math.sin(a), cx = W / 2, cy = H / 2, dx = p[0] - cx, dy = p[1] - cy;
  return [cx + dx * c + dy * s, cy - dx * s + dy * c];
}
// Knochen haben feste Längen: Ein Punkt, der einen Knochen viel zu lang oder zu kurz macht, ist falsch erkannt
// (typisch: verdeckter Arm, Fuß im Schatten). Er wird verworfen und vom Filter aus den Nachbarbildern ergänzt.
const BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [27, 31], [28, 30], [28, 32], [29, 31], [30, 32]];
function removeBoneOutliers(P, V, n, flags) {
  let removed = 0;
  const LEGB = new Set(['23-25', '25-27', '24-26', '26-28']);
  for (let pass = 0; pass < 3; pass++) {
    const med = BONES.map(([a, b]) => { const ls = []; for (let i = 0; i < n; i++) if (P[a][i] && P[b][i]) ls.push(dist(P[a][i], P[b][i])); return ls.length >= 8 ? median(ls) : NaN; });
    let any = false;
    for (let i = 0; i < n; i++) {
      const cnt = new Map(); const bad = [];
      BONES.forEach(([a, b], q) => {
        const m = med[q]; if (!(m > 0) || !P[a][i] || !P[b][i]) return;
        const leg = LEGB.has(a + '-' + b);
        // Ober- und Unterschenkel bewegen sich von der Seite gesehen fast in der Bildebene: ihre Länge ändert sich kaum
        const hi = b >= 29 ? 1.8 : leg ? 1.3 : 1.4, lo = b >= 29 ? 0.3 : leg ? 0.62 : 0.45;
        const d = dist(P[a][i], P[b][i]);
        if (d > hi * m || d < lo * m) { bad.push([a, b]); cnt.set(a, (cnt.get(a) || 0) + 1); cnt.set(b, (cnt.get(b) || 0) + 1); }
      });
      if (!bad.length) continue;
      // Hängen zwei falsche Knochen am selben Gelenk (z. B. Knie), ist dieses Gelenk falsch – nicht seine Nachbarn
      const kill = new Set();
      for (const [a, b] of bad) {
        if (kill.has(a) || kill.has(b)) continue;
        const ca = cnt.get(a), cb = cnt.get(b);
        let k = ca > cb ? a : cb > ca ? b : (V[a][i] + 0.3 < V[b][i] ? a : b);
        if (k === 23 || k === 24 || k === 11 || k === 12) k = k === a ? b : a; // Rumpfpunkte sind die verlässlichsten
        kill.add(k);
      }
      for (const k of kill) { P[k][i] = null; removed++; any = true; }
      flags[i] = 1;
    }
    if (!any) break;
  }
  // Arme: sehr unsichere Punkte des verdeckten Arms nicht verwenden
  for (const k of [13, 14, 15, 16]) for (let i = 0; i < n; i++) if (P[k][i] && V[k][i] < 0.35) { P[k][i] = null; removed++; }
  return removed;
}
export function prepareSeries(frames, W, H, fps, heightCm = 180, tilt = 0, legSwap = null, longSpikes = false) {
  const n = frames.length;
  const { P, V } = rawPixels(frames, W, H);
  if (tilt) for (let k = 0; k < 33; k++) for (let i = 0; i < n; i++) if (P[k][i]) P[k][i] = rotatePt(P[k][i], tilt, W, H);
  // grobe Beinlänge für den Maßstab (aus Rohdaten)
  const legs = [];
  for (let i = 0; i < n; i++) for (const [h, k, a] of [[23, 25, 27], [24, 26, 28]]) {
    if (P[h][i] && P[k][i] && P[a][i]) legs.push(dist(P[h][i], P[k][i]) + dist(P[k][i], P[a][i]));
  }
  const legPx = quantile(legs, 0.9) || 0.4 * H;
  const pxPerM = legPx / (0.49 * heightCm / 100);
  const flags = new Array(n).fill(0);
  let swaps = fixSwaps(P, V, n, legPx, flags);
  // Seiten-Korrektur aus dem Schrittrhythmus (siehe analyze): in diesen Bildern sind die Beine vertauscht erkannt
  if (legSwap) for (let i = 0; i < n; i++) if (legSwap[i]) {
    for (const [l, r] of LEG_PAIRS) { [P[l][i], P[r][i]] = [P[r][i], P[l][i]]; [V[l][i], V[r][i]] = [V[r][i], V[l][i]]; }
    if (!legSwap[i - 1]) swaps++;
  }
  // Schwelle: was sich zwischen zwei Bildern physikalisch nicht hin- und zurückbewegen kann
  const spikes = removeSpikes(P, n, Math.max(0.06 * legPx, (12 * pxPerM) / fps), flags, longSpikes ? Math.max(2, Math.round(0.045 * fps)) : 2);
  const boneOut = removeBoneOutliers(P, V, n, flags);
  const sigma = 0.015 * legPx; // typische Messunsicherheit (~1,3 cm)
  const maxGap = Math.max(2, Math.round(0.08 * fps));
  const S = [];
  let measured = 0; for (let k = 11; k < 33; k++) for (let i = 0; i < n; i++) if (P[k][i]) measured++;
  for (let k = 0; k < 33; k++) {
    const q = (ACCEL[k] * pxPerM / (fps * fps)) ** 2;
    const r = V[k].map((v) => (sigma / Math.max(0.25, v)) ** 2);
    const zx = P[k].map((p) => (p ? p[0] : null)), zy = P[k].map((p) => (p ? p[1] : null));
    const fx = kalmanRTS(zx, r, q, maxGap), fy = kalmanRTS(zy, r, q, maxGap);
    const arr = new Array(n).fill(null);
    for (let i = 0; i < n; i++) if (fx.out[i] != null && fy.out[i] != null) arr[i] = [fx.out[i], fy.out[i]];
    S.push(arr);
  }
  S.stats = { swaps, outliers: spikes + boneOut, outlierPct: measured ? (100 * spikes) / (measured + spikes) : 0 };
  S.raw = P; S.flags = flags; S.tilt = tilt;
  return S;
}

const mid = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a || b || null);

// Zoom ausgleichen: Zoomt die Kamera (oder läuft man auf sie zu), ändert sich die Körpergröße im Bild.
// Jedes Bild wird um die Bildmitte so skaliert, dass die Beinlänge gleich bleibt – als hätte die Kamera nicht gezoomt.
export function zoomNormalize(frames, W, H, fps) {
  const n = frames.length, leg = new Array(n).fill(NaN);
  const P = (f, k) => (f && f.lm && f.lm[k] && (f.lm[k][2] ?? 1) > 0.3 ? [f.lm[k][0] * W, f.lm[k][1] * H] : null);
  for (let i = 0; i < n; i++) {
    const f = frames[i], ls = [];
    for (const [h, k, a] of [[23, 25, 27], [24, 26, 28]]) { const ph = P(f, h), pk = P(f, k), pa = P(f, a); if (ph && pk && pa) ls.push(Math.hypot(ph[0] - pk[0], ph[1] - pk[1]) + Math.hypot(pk[0] - pa[0], pk[1] - pa[1])); }
    const sh = P(f, 11) || P(f, 12), hp = P(f, 23) || P(f, 24);
    if (sh && hp) ls.push(Math.hypot(sh[0] - hp[0], sh[1] - hp[1]) * 1.65); // Rumpf als zweites Maß (≈ Beinlänge / 1,65)
    if (ls.length) leg[i] = Math.max(...ls);
  }
  const w = Math.max(3, Math.round(0.35 * fps)), sm = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { const v = []; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (Number.isFinite(leg[j])) v.push(leg[j]); if (v.length >= 3) sm[i] = quantile(v, 0.75); }
  // Lücken füllen
  let last = -1; for (let i = 0; i < n; i++) if (Number.isFinite(sm[i])) { if (last < 0) for (let j = 0; j < i; j++) sm[j] = sm[i]; else for (let j = last + 1; j < i; j++) sm[j] = sm[last] + (sm[i] - sm[last]) * (j - last) / (i - last); last = i; }
  if (last >= 0) for (let j = last + 1; j < n; j++) sm[j] = sm[last];
  const ok = sm.filter(Number.isFinite); if (ok.length < 5) return null;
  const lo = quantile(ok, 0.1), hi = quantile(ok, 0.9);
  if (!(hi / lo > 1.3)) return null; // kein nennenswerter Zoom
  const ref = median(ok), k = sm.map((v) => ref / v), cx = W / 2, cy = H / 2;
  const out = frames.map((f, i) => (f && f.lm ? { ...f, lm: f.lm.map((p) => (p ? [(cx + (p[0] * W - cx) * k[i]) / W, (cy + (p[1] * H - cy) * k[i]) / H, p[2]] : p)) } : f));
  return { frames: out, k, ratio: hi / lo };
}

// ---------- Hauptanalyse ----------
// opts: { fps (echte Aufnahme-fps), W, H, heightCm, camera: 'fixed'|'pan', mode: 'sprint'|'hurdle', hurdle: {x,y} in normalisierten Koordinaten, startIndex }
export function analyze(frames, opts) {
  const { fps, W, H } = opts;
  const dt = 1 / fps;
  const n = frames.length;
  // Zu klein im Bild (weit weg): Die Körperpunkte sind dann zu ungenau für Kontakte und Winkel – diese Bilder nicht verwenden.
  if (!('_zn' in opts)) {
    const minPx = 0.03 * Math.max(W, H);
    let dropped = 0;
    frames = frames.map((f) => {
      if (!f || !f.lm) return f;
      const ys = f.lm.slice(0, 33).filter((p) => p && (p[2] ?? 1) > 0.3).map((p) => p[1] * H);
      if (ys.length < 8 || Math.max(...ys) - Math.min(...ys) >= minPx) return f;
      dropped++; return { ...f, lm: null };
    });
    // Sprünge: Springt die Erkennung zu einer anderen Stelle (andere Person, Muster im Hintergrund), zählt nur die längste
    // zusammenhängende Spur – Bilder davor oder danach mit einem Sprung gehören zu etwas anderem.
    const ctr = frames.map((f) => { if (!f || !f.lm) return null; const a = f.lm[23], b = f.lm[24]; return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null; });
    const segs = []; let cur = null, lastI = -1;
    for (let i = 0; i < frames.length; i++) {
      if (!ctr[i]) continue;
      const jump = cur && lastI >= 0 ? Math.hypot(ctr[i][0] - ctr[lastI][0], (ctr[i][1] - ctr[lastI][1]) * H / W) : 0;
      if (!cur || jump > 0.12 || i - lastI > Math.max(6, 0.5 * opts.fps)) { cur = { a: i, b: i, n: 0 }; segs.push(cur); }
      cur.b = i; cur.n++; lastI = i;
    }
    if (segs.length > 1) {
      const best = segs.reduce((x, y) => (y.n > x.n ? y : x));
      frames = frames.map((f, i) => (f && f.lm && (i < best.a || i > best.b) ? { ...f, lm: null } : f));
      dropped += segs.filter((g) => g !== best).reduce((t, g) => t + g.n, 0);
    }
    opts = { ...opts, _tooSmall: dropped };
  }
  const pre = '_zn' in opts; // Rekursion (automatische Neigung): Bilder sind schon zoom-bereinigt
  const zn = pre ? opts._zn : opts.noZoom ? null : zoomNormalize(frames, W, H, fps);
  const zoomK = zn ? zn.k : null;
  if (zn && !pre) { frames = zn.frames; opts = { ...opts, calib: null }; }
  const zpt = (x, y, i) => (zoomK ? [W / 2 + (x - W / 2) * zoomK[i], H / 2 + (y - H / 2) * zoomK[i]] : [x, y]);
  let tilt = 0, tiltSource = 'none';
  if (opts.laneLine) {
    let { x1, y1, x2, y2 } = opts.laneLine; if (x2 < x1) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    tilt = Math.atan2((y2 - y1) * H, (x2 - x1) * W); tiltSource = 'lane';
  } else if (Number.isFinite(opts.tilt)) { tilt = opts.tilt; tiltSource = opts.tilt ? 'auto' : 'none'; }
  const P = prepareSeries(frames, W, H, fps, opts.heightCm, tilt, opts._legSwap || null, (opts._sidePass || 0) > 0);
  const at = (k, i) => P[k][i];

  // Laufrichtung: Zehen zeigen nach vorne (robust, auch bei mitschwenkender Kamera)
  const fdx = [];
  for (let i = 0; i < n; i++) for (const s of ['L', 'R']) {
    const t = at(SIDES[s].toe, i), h = at(SIDES[s].heel, i);
    if (t && h) fdx.push(t[0] - h[0]);
  }
  let dir = Math.sign(median(fdx)) || 1;
  // bei fester Kamera zusätzlich Hüftverschiebung prüfen
  const hipMid = [];
  for (let i = 0; i < n; i++) hipMid.push(mid(at(LM.lHip, i), at(LM.rHip, i)));
  const hipValid = hipMid.map((p, i) => [p, i]).filter((x) => x[0]);
  if (opts.camera === 'fixed' && hipValid.length > 5) {
    const disp = hipValid[hipValid.length - 1][0][0] - hipValid[0][0][0];
    if (Math.abs(disp) > 0.15 * W) dir = Math.sign(disp);
  }

  // Maßstab: Beinlänge (Hüfte–Knie–Knöchel) ≈ 0,49 × Körpergröße
  const legs = [];
  for (let i = 0; i < n; i++) for (const s of ['L', 'R']) {
    const h = at(SIDES[s].hip, i), k = at(SIDES[s].knee, i), a = at(SIDES[s].ank, i);
    if (h && k && a) legs.push(Math.hypot(h[0] - k[0], h[1] - k[1]) + Math.hypot(k[0] - a[0], k[1] - a[1]));
  }
  const legPx = quantile(legs, 0.9);
  const heightM = (opts.heightCm || 180) / 100;
  let mPerPx = Number.isFinite(legPx) && legPx > 0 ? (0.49 * heightM) / legPx : NaN, scaleSource = 'height';
  // Genauer: zwei Markierungen (z. B. Hütchen) mit bekanntem Abstand – nur bei stehender Kamera sinnvoll
  if (opts.calib && opts.calib.meters > 0) {
    const a = rotatePt([opts.calib.x1 * W, opts.calib.y1 * H], tilt, W, H), b = rotatePt([opts.calib.x2 * W, opts.calib.y2 * H], tilt, W, H);
    const dpx = Math.abs(b[0] - a[0]);
    if (dpx > 20) { mPerPx = opts.calib.meters / dpx; scaleSource = 'calib'; }
  }

  // tiefster Fußpunkt je Seite (Ferse oder Zehen – je nachdem was tiefer ist)
  const footLow = { L: [], R: [] }, footX = { L: [], R: [] };
  for (let i = 0; i < n; i++) for (const s of ['L', 'R']) {
    const h = at(SIDES[s].heel, i), t = at(SIDES[s].toe, i), a = at(SIDES[s].ank, i);
    const pts = [h, t].filter(Boolean);
    if (!pts.length && a) pts.push(a);
    if (!pts.length) { footLow[s].push(NaN); footX[s].push(NaN); continue; }
    footLow[s].push(Math.max(...pts.map((p) => p[1])));
    footX[s].push(mean(pts.map((p) => p[0])));
  }
  const lowest = []; // pro Frame: tiefster Fuß
  for (let i = 0; i < n; i++) {
    const l = footLow.L[i], r = footLow.R[i];
    if (!Number.isFinite(l) && !Number.isFinite(r)) lowest.push({ y: NaN, side: null });
    else if (!Number.isFinite(r) || l >= r) lowest.push({ y: l, side: 'L' });
    else lowest.push({ y: r, side: 'R' });
  }

  // Läufergeschwindigkeit im Bild (Schrittlänge/Tempo nur bei fester Kamera sinnvoll)
  const hipVx = [];
  for (let i = 1; i < n; i++) if (hipMid[i] && hipMid[i - 1]) hipVx.push(Math.abs(hipMid[i][0] - hipMid[i - 1][0]));
  const runnerPxPerFrame = median(hipVx);
  const useSpeed = opts.camera === 'fixed' && runnerPxPerFrame * fps > 0.5 * legPx; // läuft sichtbar durchs Bild
  const tol = 0.06 * (legPx || 0.3 * H);

  // Boden lokal schätzen: hohes Quantil des tiefsten Fußpunkts in einem ~0,5-s-Fenster.
  // Funktioniert mit stehender und mitschwenkender Kamera, bei Perspektive und leichter Neigung.
  // Im Fenster wird eine Gerade an die untere Hülle der Fußpunkte gelegt (über die Fuß-x-Position),
  // so stimmt der Boden auch bei schiefer Kamera; bei mitschwenkender Kamera (Fuß-x kaum verschieden) Quantil.
  const win = Math.max(3, Math.round(0.25 * fps));
  const lowX = lowest.map((lo, i) => (lo.side ? footX[lo.side][i] : NaN));
  const ground = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const pts = [];
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) if (Number.isFinite(lowest[j].y) && Number.isFinite(lowX[j])) pts.push([lowX[j], lowest[j].y]);
    if (!pts.length) continue;
    const xs = pts.map((q) => q[0]);
    if (Math.max(...xs) - Math.min(...xs) < 0.4 * (legPx || 0.3 * H) || pts.length < 6) { ground[i] = quantile(pts.map((q) => q[1]), 0.95); continue; }
    let sel = pts, a = 0, b = 0;
    for (let it = 0; it < 4; it++) {
      const mx = mean(sel.map((q) => q[0])), my = mean(sel.map((q) => q[1]));
      let sxy = 0, sxx = 0; for (const [x, y] of sel) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
      b = sxx ? sxy / sxx : 0; a = my - b * mx;
      const keep = pts.filter(([x, y]) => y >= a + b * x - 0.3 * tol); // nur Punkte auf/unter der Linie (= am Boden) behalten
      if (keep.length < 3 || keep.length === sel.length) break; sel = keep;
    }
    const xi = Number.isFinite(lowX[i]) ? lowX[i] : mean(xs);
    ground[i] = a + b * xi;
  }
  // Boden je Fuß: Durch die Perspektive steht der kamerafernere Fuß im Bild höher als der nahe.
  // Darum bekommt jeder Fuß seine eigene untere Hülle (seine eigenen Kontakte), begrenzt durch den gemeinsamen Boden.
  const sideGround = { L: new Array(n).fill(NaN), R: new Array(n).fill(NaN) };
  const win2 = Math.max(4, Math.round(0.4 * fps));
  for (const sd of ['L', 'R']) for (let i = 0; i < n; i++) {
    const v = []; for (let j = Math.max(0, i - win2); j <= Math.min(n - 1, i + win2); j++) if (Number.isFinite(footLow[sd][j])) v.push(footLow[sd][j]);
    if (v.length >= 4) sideGround[sd][i] = quantile(v, 0.95);
  }
  const groundAt = (s, i) => {
    if (!Number.isFinite(ground[i])) return NaN; const xi = lowX[i], xs = footX[s][i];
    const g = ground[i] + (Number.isFinite(xi) && Number.isFinite(xs) && localSlope[i] ? localSlope[i] * (xs - xi) : 0);
    const gs = sideGround[s][i];
    // eigene Hülle nur verwenden, wenn sie höchstens ~1/4 Beinlänge über dem gemeinsamen Boden liegt
    return Number.isFinite(gs) && gs < g && g - gs < 0.25 * (legPx || 0.3 * H) ? gs : g;
  };
  const localSlope = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) { const dx = lowX[i + 1] - lowX[i - 1]; if (Number.isFinite(dx) && Math.abs(dx) > 1) { const sl = (ground[i + 1] - ground[i - 1]) / dx; if (Math.abs(sl) < 0.2) localSlope[i] = sl; } }

  // Fuß relativ zur Hüfte (Prinzip nach Zeni et al. 2008): Ein Fuß am Boden steht still, während die Hüfte
  // über ihn hinwegläuft – relativ zur Hüfte bewegt er sich also nach hinten. Ein Fuß in der Luft schwingt nach vorne.
  // Das gilt unabhängig davon, ob die Kamera steht oder mitschwenkt.
  const relX = { L: [], R: [] }, vrel = { L: [], R: [] };
  for (const s of ['L', 'R']) {
    for (let i = 0; i < n; i++) relX[s].push(hipMid[i] && Number.isFinite(footX[s][i]) ? dir * (footX[s][i] - hipMid[i][0]) : NaN);
    for (let i = 0; i < n; i++) {
      const a = relX[s][i - 1], b = relX[s][i + 1], c = relX[s][i];
      vrel[s].push(Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 2 : Number.isFinite(b) && Number.isFinite(c) ? b - c : Number.isFinite(a) && Number.isFinite(c) ? c - a : NaN);
    }
  }
  const vSwing = Math.max(quantile([...vrel.L, ...vrel.R].filter((v) => v > 0), 0.9) || 0, 0.02 * legPx);
  // „Kontakt-Abstand“: > 0 = Kontakt, < 0 = Luft. Stetig -> Aufsetzen/Abdruck lassen sich zwischen Bildern interpolieren.
  const margin = (s, i, lvl = 1) => {
    if (i < 0 || i >= n) return NaN;
    const y = footLow[s][i], g = groundAt(s, i);
    if (!Number.isFinite(y) || !Number.isFinite(g)) return NaN;
    // Grundregel: Der Fuß am Boden ist der tiefere. Liegt der andere Fuß deutlich tiefer im Bild, ist dieser hier in der Luft.
    const yo = footLow[s === 'L' ? 'R' : 'L'][i];
    if (Number.isFinite(yo) && yo - y > 1.2 * tol) return -1;
    const h = (y - (g - lvl * tol)) / tol;
    const v = vrel[s][i];
    if (!Number.isFinite(v)) return h;
    const a = Math.min(h, (0.05 * vSwing - v) / (0.3 * vSwing));
    // Zweiter Weg: Der Fuß wandert deutlich nach hinten (relativ zur Hüfte) und ist nah am Boden –
    // das ist ein Stütz, auch wenn der Fußpunkt durch Perspektive oder Verdeckung etwas zu hoch sitzt.
    const hb = (y - (g - 5 * lvl * tol)) / (5 * tol);
    // … aber nicht, wenn der Fuß gerade deutlich steigt (er hebt nach dem Abdruck ab)
    const yp = footLow[s][i - 1], yn = footLow[s][i + 1];
    const rise = Number.isFinite(yp) && Number.isFinite(yn) ? (yp - yn) / 2 : 0; // > 0 = Fuß steigt
    const b = Math.min(hb, (-0.2 * vSwing - v) / (0.3 * vSwing), (0.6 * tol - rise) / tol);
    return Math.max(a, b);
  };
  const dbg = opts.debug ? { footLow, ground: null, tol, vrel, vSwing, margin: null } : null;
  const gap = Math.max(1, Math.round(0.012 * fps));
  const minLen = Math.max(2, Math.round(0.035 * fps));
  const segsFor = (s) => {
    const raw = [];
    for (let i = 0; i < n; ) {
      if (!(margin(s, i) >= 0)) { i++; continue; }
      let j = i; while (j + 1 < n && margin(s, j + 1) >= 0) j++;
      raw.push([i, j]); i = j + 1;
    }
    const merged = [];
    // Ein Fuß kann nicht innerhalb von ~70 ms abheben und wieder aufsetzen: so kurze Unterbrechungen desselben Fußes
    // sind Erkennungsfehler (z. B. das Bein war kurz verdeckt) und werden überbrückt.
    const gapSame = Math.max(gap, Math.round(0.07 * fps)), maxSpan = Math.round(0.3 * fps);
    for (const sg of raw) { const last = merged[merged.length - 1]; const g = last ? sg[0] - last[1] - 1 : Infinity; if (last && (g <= gap || (g <= gapSame && sg[1] - last[0] + 1 <= maxSpan))) last[1] = sg[1]; else merged.push([...sg]); }
    // Ränder schärfen: Im Stütz ist der Fuß am tiefsten. Bilder, in denen er schon deutlich höher ist
    // (Fuß hebt ab, wandert aber relativ zur Hüfte noch nach hinten), gehören nicht mehr zum Kontakt.
    const refined = merged.map(([i0, i1]) => {
      const ys = []; for (let i = i0; i <= i1; i++) if (Number.isFinite(footLow[s][i])) ys.push(footLow[s][i]);
      if (ys.length < 3) return [i0, i1];
      const lowY = quantile(ys, 0.7); // robust gegen einen einzelnen Ausreißer nach unten
      const near = (i) => Number.isFinite(footLow[s][i]) && footLow[s][i] >= lowY - 1.6 * tol;
      let a = i0, b = i1; while (a < b && !near(a)) a++; while (b > a && !near(b)) b--;
      return [a, b];
    });
    // Ein Kontakt muss irgendwann wirklich am Boden sein (höchstens ~2,5 Toleranzen darüber)
    const touches = ([i0, i1]) => { for (let i = i0; i <= i1; i++) { const y = footLow[s][i], g = groundAt(s, i); if (Number.isFinite(y) && Number.isFinite(g) && g - y <= 2.5 * tol) return true; } return false; };
    return refined.filter((sg) => sg[1] - sg[0] + 1 >= minLen && touches(sg)).map(([i0, i1]) => ({ i0, i1, side: s }));
  };
  // Aufsetzen und Abdruck eines Kontakts aus dem Höhenverlauf des tiefsten Fußpunkts:
  // Standniveau P des Kontakts bestimmen, dann den Knick suchen, an dem die Abwärtsbewegung auf P trifft bzw. der Fuß P wieder verlässt.
  const lowAny = footLow.L.map((v, i) => { const w = footLow.R[i]; return Number.isFinite(v) && Number.isFinite(w) ? Math.max(v, w) : Number.isFinite(v) ? v : w; });
  function plateauEdges(s, i0, i1) {
    const y = lowAny, ys = [];
    for (let i = i0; i <= i1; i++) if (Number.isFinite(y[i])) ys.push(y[i]);
    if (ys.length < 3) return null;
    // Standniveau: Median der tiefsten Fußlagen dieses Kontakts (die Bilder vor dem Aufsetzen und nach dem Abdruck liegen höher und zählen nicht mit)
    const P0 = quantile(ys, 0.8), flat = ys.filter((v) => v >= P0 - 0.25 * tol), P = median(flat), mad = median(flat.map((v) => Math.abs(v - P))) || 0;
    const d = Math.max(0.06 * tol, Math.min(0.3 * tol, 3 * 1.4826 * mad)); // Abstand zum Standniveau, ab dem der Fuß sicher in der Luft ist
    const on = (i) => i >= 0 && i < n && Number.isFinite(y[i]) && y[i] >= P - d;
    let m = -1, c = (i0 + i1) >> 1; for (let k = 0; k <= i1 - i0; k++) { const j = c + (k % 2 ? -(k + 1 >> 1) : k >> 1); if (j >= i0 && j <= i1 && on(j)) { m = j; break; } }
    if (m < 0) return null;
    const ext = Math.max(2, Math.round(0.05 * fps)), K = Math.max(2, Math.round(0.025 * fps)), maxF = Math.max(1, 0.03 * fps);
    // rückwärts/vorwärts bis zum ersten Bild, in dem der Fuß sicher über dem Standniveau ist (ein einzelner Ausreißer wird übersprungen)
    let a = m; while (a - 1 >= Math.max(0, i0 - ext) && (on(a - 1) || (on(a - 2) && a - 2 >= i0))) a--;
    let b = m; while (b + 1 <= Math.min(n - 1, i1 + ext) && (on(b + 1) || (on(b + 2) && b + 2 <= i1))) b++;
    const knee = (edge, dirn) => { // edge = erstes/letztes Standbild; dirn = -1 (Aufsetzen) oder +1 (Abdruck)
      const o = edge + dirn;
      if (o < 0 || o >= n || !Number.isFinite(y[o])) return NaN;
      // Gerade durch die letzten Bilder in der Luft (über ~25 ms), geschnitten mit dem Standniveau: der Knick ist der Ereigniszeitpunkt
      const xs = [], vs = [];
      for (let k = 0; k < K; k++) { const q = o + k * dirn; if (q < 0 || q >= n || !Number.isFinite(y[q])) break; if (k > 1 && y[q] > y[q - dirn] + 0.5 * d) break; xs.push(q); vs.push(y[q]); }
      if (xs.length >= 2) {
        const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = vs.reduce((p, q) => p + q, 0) / vs.length;
        let sxy = 0, sxx = 0; for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (vs[k] - my); sxx += (xs[k] - mx) ** 2; }
        const beta = sxx ? sxy / sxx : 0; // Steigung in px je Bild; beim Aufsetzen > 0 (Fuß sinkt), beim Abdruck < 0 (Fuß steigt)
        if (-dirn * beta > 0.02 * tol) { const t = mx + (P - my) / beta, f = -dirn * (t - o); if (f >= 0 && f <= maxF) return t; if (f > maxF) return o - dirn * maxF; }
      }
      const dy = y[edge] - y[o], f = dy > 0 ? Math.max(0, Math.min(1, (P - d - y[o]) / dy)) : 0.5;
      return o - dirn * f;
    };
    return { td: knee(a, -1), to: knee(b, +1) };
  }
  const forced = Array.isArray(opts.forcedContacts) ? opts.forcedContacts : null; // manuell korrigierte Kontakte
  let segList = forced ? forced.map((c) => ({ ...c })).sort((x, y) => x.i0 - y.i0) : [...segsFor('L'), ...segsFor('R')].sort((x, y) => x.i0 - y.i0);
  if (!forced) {
    const maxLen = Math.round(0.22 * fps), out = [];
    for (const sg of segList) {
      const last = out[out.length - 1];
      // zwischen zwei echten Kontakten liegt beim Sprint immer eine Flugphase
      if (last && last.side !== sg.side && sg.i0 - last.i1 <= gap + 1 && sg.i1 - last.i0 + 1 <= maxLen) { if (sg.i1 - sg.i0 > last.i1 - last.i0) last.side = sg.side; last.i1 = Math.max(last.i1, sg.i1); last.relabeled = true; }
      else out.push({ ...sg });
    }
    segList = out;
  }
  // Überlappungen (beide Füße gleichzeitig „am Boden“ – im Sprint fast nie, meist ein Erkennungsfehler): schwächeren verwerfen
  const meanMargin = (sg) => { let t = 0, c = 0; for (let i = sg.i0; i <= sg.i1; i++) { const m = margin(sg.side, i); if (Number.isFinite(m)) { t += m; c++; } } return c ? t / c : -Infinity; };
  for (let k = 0; !forced && k + 1 < segList.length; ) {
    const A = segList[k], B = segList[k + 1];
    const ov = Math.min(A.i1, B.i1) - Math.max(A.i0, B.i0) + 1;
    if (A.side !== B.side && ov > 0.5 * Math.min(A.i1 - A.i0 + 1, B.i1 - B.i0 + 1)) { segList.splice(meanMargin(A) >= meanMargin(B) ? k + 1 : k, 1); continue; }
    k++;
  }

  // Ein Kontakt in zwei Hälften: direkt aneinander, viel kürzer als ein Schritt -> zusammenlegen
  if (!forced && segList.length >= 4) {
    const st0 = []; for (let k = 1; k < segList.length; k++) st0.push(segList[k].i0 - segList[k - 1].i0);
    const med0 = median(st0);
    for (let k = 0; k + 1 < segList.length; ) {
      const A = segList[k], B = segList[k + 1];
      if (B.i0 - A.i1 <= 2 && B.i0 - A.i0 < 0.6 * med0 && (B.i1 - A.i0) < 0.8 * med0) {
        const side = meanMargin(A) * (A.i1 - A.i0 + 1) >= meanMargin(B) * (B.i1 - B.i0 + 1) ? A.side : B.side;
        segList.splice(k, 2, { i0: A.i0, i1: Math.max(A.i1, B.i1), side }); continue;
      }
      k++;
    }
  }
  // Zu dicht: Zwei Kontakte in viel kürzerem Abstand als der übliche Schritt sind physikalisch kaum möglich –
  // meist hat die Erkennung einen Fuß kurz falsch zugeordnet. Der schwächere der beiden fällt weg.
  if (!forced && segList.length >= 4) {
    for (let pass = 0; pass < 3; pass++) {
      const st = []; for (let k = 1; k < segList.length; k++) st.push(segList[k].i0 - segList[k - 1].i0);
      const med = median(st); if (!(med > 2)) break;
      let changed = false;
      for (let k = 1; k + 1 < segList.length; k++) {
        const A = segList[k - 1], B = segList[k], C = segList[k + 1];
        if (B.i0 - A.i0 < 0.6 * med && C.i0 - B.i0 < 0.75 * med) { // B quetscht sich zwischen zwei Kontakte
          // Gleiche Seite wie ein Nachbar? Dann ist B oder dieser Nachbar falsch – den schwächeren entfernen.
          const nb = A.side === B.side ? A : C.side === B.side ? C : (B.i0 - A.i0 < C.i0 - B.i0 ? A : C);
          segList.splice(segList.indexOf(meanMargin(B) >= meanMargin(nb) ? nb : B), 1); changed = true; break;
        }
      }
      if (!changed) break;
    }
  }

  // Schritte kommen im Rhythmus: Ist die Lücke zwischen zwei Kontakten deutlich größer als üblich,
  // wird im erwarteten Zeitfenster mit gelockerten Schwellen nach dem fehlenden Kontakt gesucht (abwechselnde Seite).
  const recovered = [];
  if (!forced && segList.length >= 3) {
    const ints = []; for (let k = 1; k < segList.length; k++) ints.push(segList[k].i0 - segList[k - 1].i0);
    const med = median(ints);
    const relaxed = (sd, i) => {
      const y = footLow[sd][i], g = groundAt(sd, i); if (!Number.isFinite(y) || !Number.isFinite(g)) return NaN;
      const h = (y - (g - 2 * tol)) / (2 * tol), v = vrel[sd][i];
      return Number.isFinite(v) ? Math.min(h, (0.35 * vSwing - v) / (0.35 * vSwing)) : h;
    };
    const add = [];
    for (let k = 0; k + 1 < segList.length; k++) {
      const A = segList[k], B = segList[k + 1], d = B.i0 - A.i0;
      const sameSide = A.side === B.side && d > 1.25 * med;
      if (!(d > 1.6 * med) && !sameSide) continue;
      if (opts.mode === 'hurdle' && !sameSide) continue; // lange Flugphase mit Seitenwechsel = Hürde, kein verpasster Schritt
      const m = sameSide ? Math.max(1, Math.round(d / med) - 1) : Math.round(d / med) - 1;
      for (let j = 1; j <= m; j++) {
        const sd = (j % 2 === 1) === true ? (A.side === 'L' ? 'R' : 'L') : A.side;
        const c = Math.round(A.i0 + j * d / (m + 1)), w = Math.round(0.35 * med);
        let best = null;
        for (let i = Math.max(A.i1 + 1, c - w); i <= Math.min(B.i0 - 1, c + w); ) {
          if (!(relaxed(sd, i) >= 0)) { i++; continue; }
          let e = i; while (e + 1 <= Math.min(B.i0 - 1, c + w) && relaxed(sd, e + 1) >= 0) e++;
          if (!best || e - i > best.i1 - best.i0) best = { i0: i, i1: e, side: sd };
          i = e + 1;
        }
        if (best && best.i1 - best.i0 + 1 >= Math.max(2, Math.round(minLen / 2))) { best.recovered = true; add.push(best); }
      }
    }
    if (add.length) { segList = [...segList, ...add].sort((x, y) => x.i0 - y.i0); recovered.push(...add); }
  }

  // Bodenlinie als Gerade durch die Fußkontakte (feste Kamera, Läufer durchquert das Bild):
  // ihre Neigung verrät eine schief gehaltene Kamera.
  let groundLine = null;
  if (useSpeed && segList.length >= 2) {
    const pts = segList.map(({ i0, i1, side }) => { const im = Math.round((i0 + i1) / 2); return [footX[side][im], footLow[side][im]]; }).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    const span = pts.length ? Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])) : 0;
    if (pts.length >= 2 && span > 0.15 * W) {
      const mx = mean(pts.map((q) => q[0])), my = mean(pts.map((q) => q[1]));
      let sxy = 0, sxx = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
      const b = sxx ? sxy / sxx : 0, a = my - b * mx, ang = Math.atan(b);
      if (tiltSource === 'none' && opts.autoTilt !== false && Math.abs(ang) > (0.6 * Math.PI) / 180 && Math.abs(ang) < (8 * Math.PI) / 180) {
        const res = analyze(frames, { ...opts, tilt: ang, autoTilt: false, _zn: zn || null });
        res.tiltSource = 'auto'; return res;
      }
      groundLine = { a, b };
    }
  }

  // Startblock / Stand: Solange sich niemand bewegt, sind beide Füße „am Boden“ – das sind keine Schritte.
  // Bewegungsbeginn = erstes Bild, in dem ein Fuß deutlich nach vorne schwingt.
  let motionStart = 0;
  if (!forced) {
    const vmax = (i) => Math.max(vrel.L[i] || 0, vrel.R[i] || 0);
    for (let i = 1; i < n - 3; i++) { if (vmax(i) > 0.25 * vSwing && vmax(i + 1) > 0.25 * vSwing && vmax(i + 2) > 0.25 * vSwing) { motionStart = i; break; } }
    let seenBefore = 0; for (let i = Math.max(0, motionStart - Math.round(0.5 * fps)); i < motionStart; i++) if (hipMid[i]) seenBefore++;
    if (motionStart > 0.15 * fps && seenBefore >= 0.3 * fps) { // nur wenn die Person vorher wirklich still zu sehen war (Block/Stand)
      // Kontakte, die vor dem Bewegungsbeginn enden, fallen weg; einer, der darüber hinaus reicht, ist der Abdruck aus dem Block
      segList = segList.filter((sg) => sg.i1 >= motionStart);
      segList.forEach((sg) => { if (sg.i0 < motionStart) { sg.i0 = Math.max(sg.i0, motionStart - Math.round(0.15 * fps)); sg.block = true; } });
    }
  }

  // Füße wechseln sich ab: Wird links/rechts verwechselt (häufig bei schräger Sicht), Seiten so zuordnen,
  // dass sie abwechseln und möglichst viele Erkennungen bestätigen. Eine Lücke von zwei Schritten = gleiche Seite.
  if (!forced && segList.length >= 4) {
    const st1 = []; for (let k = 1; k < segList.length; k++) st1.push(segList[k].i0 - segList[k - 1].i0);
    const med1 = median(st1);
    if (med1 > 2) {
      const par = [0]; for (let k = 1; k < segList.length; k++) { const d = segList[k].i0 - segList[k - 1].i0; const nst = opts.mode === 'hurdle' ? (d < 2.6 * med1 ? 1 : Math.round(d / med1)) : (d < 1.75 * med1 ? 1 : Math.round(d / med1)); par.push((par[k - 1] + nst) % 2); }
      let agreeL = 0; segList.forEach((sg, k) => { if ((par[k] === 0) === (sg.side === 'L')) agreeL++; });
      const first = agreeL >= segList.length - agreeL ? 'L' : 'R', other = first === 'L' ? 'R' : 'L';
      segList.forEach((sg, k) => { sg.side = par[k] === 0 ? first : other; });
    }
  }

  const contacts = segList.map(({ i0, i1, side, recovered: rec, td: ftd, to: fto, manual, block }) => {
    // Zeitpunkt zwischen zwei Bildern: wo der Kontakt-Abstand die Null kreuzt (lineare Interpolation)
    const heightOnly = (i) => { if (i < 0 || i >= n) return NaN; const y = footLow[side][i], g = groundAt(side, i); return Number.isFinite(y) && Number.isFinite(g) ? (y - (g - LVL * tol)) / tol : NaN; };
    const cross = (a, b, fallback) => {
      for (const fn of [(i) => margin(side, i, LVL), heightOnly]) {
        const ma = fn(a), mb = fn(b);
        if (Number.isFinite(ma) && Number.isFinite(mb) && ma !== mb && Math.sign(ma) !== Math.sign(mb)) return a + ma / (ma - mb) * (b - a);
      }
      return fallback;
    };
    // manuell gesetzte Kontakte: Beginn/Ende genau auf dem Bild (halbes Bild davor/danach)
    let td = forced ? (Number.isFinite(ftd) && !manual ? ftd : i0 - 0.5) : cross(i0 - 1, i0, i0 - 0.5);
    let to = forced ? (Number.isFinite(fto) && !manual ? fto : i1 + 0.5) : cross(i1, i1 + 1, i1 + 0.5);
    if (!forced && !opts.legacyEdges) {
      // Feinbestimmung am Fuß selbst (nach Nagahara & Zushi 2013: Aufsetzen = der Fuß stoppt seine Abwärtsbewegung,
      // Abdruck = der Fuß verlässt seinen tiefsten Punkt). Maßstab ist das Standniveau genau dieses Kontakts,
      // nicht der geschätzte Boden – so löst ein Fuß, der sich knapp über dem Boden schon nach hinten bewegt, nicht zu früh aus.
      const e = plateauEdges(side, i0, i1);
      if (e) {
        if (Number.isFinite(e.td)) td = e.td;
        if (Number.isFinite(e.to)) to = e.to;
        if (to - td >= Math.max(1.5, 0.03 * fps)) { i0 = Math.max(0, Math.min(n - 1, Math.ceil(td))); i1 = Math.max(i0, Math.min(n - 1, Math.floor(to))); }
      }
    }
    return { i0, i1, td, to, side, partial: i0 === 0 || i1 === n - 1 || !!block, block: !!block, recovered: !!rec, manual: !!manual };
  });

  // Seiten aus dem Rhythmus absichern: Beim Laufen wechseln sich die Füße immer ab. Daraus folgt für jedes Bild,
  // welches Bein wo sein muss: Im Stütz ist der Stützfuß der tiefere, im Flug ist der Fuß des nächsten Kontakts vorne.
  // Widerspricht die Erkennung dem über mehrere Bilder, hat sie die Beine vertauscht – dann werden die Beinpunkte
  // in diesen Bildern getauscht und alles neu berechnet. So bleiben Farben, Kontakte und Winkel beim selben Bein.
  if ((opts._sidePass || 0) < 2 && contacts.length >= 3 && opts.sideFix !== false) {
    const ev = new Array(n).fill(0), clamp = (v) => Math.max(-3, Math.min(3, v));
    const fl = contacts.map((c, k) => (contacts[k + 1] ? contacts[k + 1].i0 - c.i1 : NaN)), medFl = median(fl);
    contacts.forEach((c, k) => {
      const S = c.side, O = S === 'L' ? 'R' : 'L';
      for (let i = c.i0; i <= c.i1; i++) { const a = footLow[S][i], b = footLow[O][i]; if (Number.isFinite(a) && Number.isFinite(b)) ev[i] = clamp((b - a) / tol); }
      const nx = contacts[k + 1];
      if (!nx || nx.side === S || !(fl[k] <= 1.8 * medFl + 1)) return; // Lücke/Hürde: keine Aussage
      for (let i = c.i1 + 1; i < nx.i0; i++) { const a = relX[S][i], b = relX[nx.side][i]; if (Number.isFinite(a) && Number.isFinite(b)) ev[i] = clamp((a - b) / (0.25 * legPx)); }
    });
    // glatteste Folge „vertauscht / nicht vertauscht“ (Viterbi): ein Wechsel kostet, einzelne unklare Bilder kippen nichts
    const lam = 2 + 0.03 * fps, c0 = new Array(n), c1 = new Array(n), b0 = new Array(n), b1 = new Array(n);
    c0[0] = Math.max(0, ev[0]); c1[0] = Math.max(0, -ev[0]) + lam;
    for (let i = 1; i < n; i++) {
      const e0 = Math.max(0, ev[i]), e1 = Math.max(0, -ev[i]);
      if (c0[i - 1] <= c1[i - 1] + lam) { c0[i] = c0[i - 1] + e0; b0[i] = 0; } else { c0[i] = c1[i - 1] + lam + e0; b0[i] = 1; }
      if (c1[i - 1] <= c0[i - 1] + lam) { c1[i] = c1[i - 1] + e1; b1[i] = 1; } else { c1[i] = c0[i - 1] + lam + e1; b1[i] = 0; }
    }
    const mask = new Array(n).fill(false); let stt = c1[n - 1] < c0[n - 1] ? 1 : 0, cntSw = 0;
    for (let i = n - 1; i >= 0; i--) { mask[i] = stt === 1; if (stt) cntSw++; if (i > 0) stt = stt ? b1[i] : b0[i]; }
    if (cntSw >= n) { mask.fill(false); cntSw = 0; }
    // Zweiter Durchgang immer: erst wenn die Seiten stimmen, lassen sich längere Aussetzer eines Beins sicher erkennen
    if (cntSw > 0 || !opts._sidePass) {
      const prev = opts._legSwap, comb = mask.map((m, i) => m !== !!(prev && prev[i]));
      const res = analyze(frames, { ...opts, _zn: zn || null, _legSwap: comb, _sidePass: (opts._sidePass || 0) + 1 });
      res.quality.sideFixed = (res.quality.sideFixed || 0) + cntSw;
      return res;
    }
  }

  // Hilfsfunktionen pro Frame
  const rob = (fn) => (fps >= 90 ? (s, i) => { const v = fn(s, i); return Number.isFinite(v) ? median([fn(s, i - 1), v, fn(s, i + 1)]) : v; } : fn);
  const thigh = rob((s, i) => { const h = at(SIDES[s].hip, i), k = at(SIDES[s].knee, i); return h && k ? segFromDown(h, k, dir) : NaN; });
  const knee = rob((s, i) => { const h = at(SIDES[s].hip, i), k = at(SIDES[s].knee, i), a = at(SIDES[s].ank, i); return h && k && a ? jointAngle(h, k, a) : NaN; });
  const upperArm = rob((s, i) => { const sh = at(SIDES[s].sh, i), e = at(SIDES[s].el, i); return sh && e ? segFromDown(sh, e, dir) : NaN; });
  const elbow = rob((s, i) => { const sh = at(SIDES[s].sh, i), e = at(SIDES[s].el, i), w = at(SIDES[s].wr, i); return sh && e && w ? jointAngle(sh, e, w) : NaN; });
  const trunk = (i) => { const sm = mid(at(LM.lSh, i), at(LM.rSh, i)); return sm && hipMid[i] ? segFromUp(hipMid[i], sm, dir) : NaN; };
  const cm = (px) => (Number.isFinite(mPerPx) ? px * mPerPx * 100 : NaN);
  const other = (s) => (s === 'L' ? 'R' : 'L');

  const steps = contacts.map((c, idx) => {
    const next = contacts[idx + 1];
    const s = c.side;
    const i0 = c.i0, i1 = c.i1, iEnd = next ? next.i0 : Math.min(n - 1, i1 + Math.round(0.12 * fps));
    const st = {
      index: idx + 1, side: s, i0, i1, partial: c.partial, include: !c.partial, recovered: c.recovered, manual: c.manual,
      contactMs: c.partial ? NaN : (c.to - c.td) * dt * 1000,
      flightMs: next && !c.partial ? (next.td - c.to) * dt * 1000 : NaN,
      stepTimeMs: next ? (next.td - c.td) * dt * 1000 : NaN,
    };
    // Vertrauen: Sichtbarkeit des Standbeins, Anteil korrigierter Bilder
    const visK = [SIDES[s].hip, SIDES[s].knee, SIDES[s].ank, SIDES[s].heel, SIDES[s].toe];
    let vsum = 0, vc = 0, corr = 0, miss = 0;
    for (let i = i0; i <= iEnd; i++) {
      const f = frames[i];
      if (!f || !f.lm) { miss++; continue; }
      for (const k of visK) { vsum += f.lm[k] ? (f.lm[k][2] ?? 1) : 0; vc++; }
      if (P.flags[i]) corr++;
    }
    const len = iEnd - i0 + 1;
    st.confidence = Math.max(0, Math.min(1, (vc ? vsum / vc : 0) * (1 - miss / len) * (1 - 0.6 * corr / len)));
    st.flags = [];
    if (!c.partial) {
      if (st.contactMs < 50) st.flags.push('Kontakt unrealistisch kurz');
      if (st.contactMs > 300) st.flags.push('Kontakt unrealistisch lang');
      if (st.flightMs < 0) st.flags.push('negative Flugzeit');
      if (st.stepTimeMs > 450 && !(opts.mode === 'hurdle' && next && next.side !== s)) st.flags.push('Schritt dazwischen verpasst?');
    }
    // Fuß des Standbeins rund um Aufsetzen und Abdruck: nur wenn er dort sicher erkannt ist, stimmt die Kontaktzeit
    { const fk = [SIDES[s].ank, SIDES[s].heel, SIDES[s].toe]; let fs = 0, fc = 0, fm = 0;
      for (const e of [i0, iEnd]) for (let i = e - 2; i <= e + 2; i++) { if (i < 0 || i >= n) continue; const f = frames[i]; if (!f || !f.lm) { fm++; fc += 3; continue; } for (const k of fk) { fs += f.lm[k] ? (f.lm[k][2] ?? 1) : 0; fc++; } }
      st.footConf = fc ? fs / fc : 0;
      if (st.footConf < 0.5 || fm >= 2) st.flags.push('Fuß unsicher erkannt');
      if (st.footConf < 0.3 && !c.partial) st.include = false;
    }
    if (st.confidence < 0.5) st.flags.push('Erkennung unsicher');
    if (st.flags.length && !c.partial && (st.confidence < 0.35 || st.contactMs < 40 || st.flightMs < -20)) st.include = false;
    st.cadenceHz = Number.isFinite(st.stepTimeMs) ? 1000 / st.stepTimeMs : NaN;
    // Aufsetzen
    st.touchdownCm = hipMid[i0] && Number.isFinite(footX[s][i0]) ? cm(dir * (footX[s][i0] - hipMid[i0][0])) : NaN;
    st.kneeTD = knee(s, i0);
    st.thighSepTD = Math.abs(thigh('L', i0) - thigh('R', i0));
    // Stützphase
    let kmin = Infinity;
    for (let i = i0; i <= i1; i++) { const k = knee(s, i); if (Number.isFinite(k)) kmin = Math.min(kmin, k); }
    st.kneeMinStance = Number.isFinite(kmin) ? kmin : NaN;
    // Abdruck (letzter Kontakt-Frame)
    st.kneeTO = knee(s, i1);
    st.hipExtTO = -Math.min(thigh('L', i1), thigh('R', i1)); // Grad hinter der Senkrechten
    // gesamter Schritt (Aufsetzen bis nächstes Aufsetzen)
    const tr = [], hy = [], fwd = [], armL = [], armR = [], elb = [];
    for (let i = i0; i <= iEnd; i++) {
      tr.push(trunk(i));
      if (hipMid[i]) hy.push(hipMid[i][1]);
      fwd.push(Math.max(thigh('L', i), thigh('R', i)));
      armL.push(upperArm('L', i)); armR.push(upperArm('R', i));
      elb.push(elbow('L', i), elbow('R', i));
    }
    st.trunkDeg = mean(tr);
    // Kinogramm-Momente in der Flugphase: MVP = höchster Hüftpunkt, Strike = Schwungfuß am weitesten vorne
    if (next) {
      let iM = -1, yMin = Infinity, iS = -1, xMax = -Infinity;
      for (let i = i1 + 1; i < next.i0; i++) {
        if (hipMid[i] && hipMid[i][1] < yMin) { yMin = hipMid[i][1]; iM = i; }
        const rx = relX[next.side][i]; if (Number.isFinite(rx) && rx > xMax) { xMax = rx; iS = i; }
      }
      st.iMVP = iM >= 0 ? iM : Math.round((i1 + next.i0) / 2); st.iStrike = iS >= 0 ? iS : next.i0 - 1;
    }
    st.kneeLiftDeg = Math.max(...fwd.filter(Number.isFinite));
    st.iKneeLift = i0 + fwd.indexOf(st.kneeLiftDeg);
    if (!Number.isFinite(st.kneeLiftDeg)) st.kneeLiftDeg = NaN;
    st.vertOscCm = hy.length > 2 ? cm(Math.max(...hy) - Math.min(...hy)) : NaN;
    const rng = (a) => { const v = a.filter(Number.isFinite); return v.length > 2 ? Math.max(...v) - Math.min(...v) : NaN; };
    st.armRangeDeg = mean([rng(armL), rng(armR)]);
    st.elbowDeg = mean(elb);
    // Arme im Detail: wie weit vor / hinter die Senkrechte, Ellbogen vorne / hinten, Symmetrie
    const armDetail = (arr, side) => {
      let iF = -1, iB = -1, vF = -Infinity, vB = Infinity;
      for (let j = 0; j < arr.length; j++) { const v = arr[j]; if (!Number.isFinite(v)) continue; if (v > vF) { vF = v; iF = j; } if (v < vB) { vB = v; iB = j; } }
      return { fwd: iF >= 0 ? vF : NaN, back: iB >= 0 ? -vB : NaN, elbF: iF >= 0 ? elbow(side, i0 + iF) : NaN, elbB: iB >= 0 ? elbow(side, i0 + iB) : NaN, range: rng(arr) };
    };
    const aL = armDetail(armL, 'L'), aR = armDetail(armR, 'R');
    { let bf = -Infinity, bb = Infinity; for (let j = 0; j < armL.length; j++) for (const v of [armL[j], armR[j]]) { if (!Number.isFinite(v)) continue; if (v > bf) { bf = v; st.iArmF = i0 + j; } if (v < bb) { bb = v; st.iArmB = i0 + j; } } }
    st.armFwdDeg = mean([aL.fwd, aR.fwd]);
    st.armBackDeg = mean([aL.back, aR.back]);
    st.elbowFrontDeg = mean([aL.elbF, aR.elbF]);
    st.elbowBackDeg = mean([aL.elbB, aR.elbB]);
    st.armAsymDeg = Number.isFinite(aL.range) && Number.isFinite(aR.range) ? Math.abs(aL.range - aR.range) : NaN;
    // Haltung beim Abdruck: Körperlinie Fuß -> Schulter und Hüftknick (Hüfte hinter/vor dieser Linie)
    {
      const shM = mid(at(LM.lSh, i1), at(LM.rSh, i1)), hp = hipMid[i1];
      const ft = at(SIDES[s].toe, i1) || at(SIDES[s].ank, i1), an = at(SIDES[s].ank, i1) || ft;
      if (shM && hp && ft && an) {
        st.bodyLeanTO = segFromUp(ft, shM, dir);
        const ang = jointAngle(shM, hp, an);
        const ux = shM[0] - an[0], uy = shM[1] - an[1];
        const cross = ux * (hp[1] - an[1]) - uy * (hp[0] - an[0]);
        st.hipKinkTO = (cross * -dir >= 0 ? 1 : -1) * (180 - ang); // + = Hüfte hinter der Linie („Sitzen“/Abknicken)
        st.trunkTO = segFromUp(hp, shM, dir);
      } else { st.bodyLeanTO = NaN; st.hipKinkTO = NaN; st.trunkTO = NaN; }
      st.hipFlexMid = NaN; st.hipHeightMid = NaN;
      // Stützmitte: Fuß am nächsten unter der Hüfte -> Hüftwinkel Schulter–Hüfte–Knie („Sitzen“?)
      let iMid = i0, best = Infinity;
      for (let i = i0; i <= i1; i++) { const d = hipMid[i] && Number.isFinite(footX[s][i]) ? Math.abs(footX[s][i] - hipMid[i][0]) : Infinity; if (d < best) { best = d; iMid = i; } }
      st.iMid = iMid;
      const shMm = mid(at(LM.lSh, iMid), at(LM.rSh, iMid)), knM = at(SIDES[s].knee, iMid);
      st.hipFlexMid = shMm && hipMid[iMid] && knM ? 180 - jointAngle(shMm, hipMid[iMid], knM) : NaN;
      // Hüfthöhe in der Stützmitte relativ zur Hüfthöhe im Stand (≈ 53 % der Körpergröße)
      st.hipHeightMid = hipMid[iMid] && Number.isFinite(ground[iMid]) && Number.isFinite(mPerPx) ? (ground[iMid] - hipMid[iMid][1]) * mPerPx / (0.53 * heightM) * 100 : NaN;
      const an0 = at(SIDES[s].ank, i0), kn0 = at(SIDES[s].knee, i0);
      st.shinTD = an0 && kn0 ? segFromUp(an0, kn0, dir) : NaN; // + = Knie vor dem Knöchel
      // Fußaufsatz: Winkel Ferse -> Zehen gegen den Boden beim Aufsetzen (+ = Zehen oben = Fersenaufsatz)
      const he0 = at(SIDES[s].heel, i0), to0 = at(SIDES[s].toe, i0);
      st.footAngleTD = he0 && to0 ? Math.atan2(to0[1] - he0[1] === 0 ? 0 : -(to0[1] - he0[1]), Math.abs(to0[0] - he0[0])) * 180 / Math.PI : NaN;
      st.footStrike = !Number.isFinite(st.footAngleTD) ? '' : st.footAngleTD > 8 ? 'Ferse' : st.footAngleTD > -6 ? 'Mittelfuß' : 'Vorfuß';
      st.ankleTD = kn0 && an0 && to0 ? jointAngle(kn0, an0, to0) : NaN;
    }
    // Schrittlänge/Tempo nur bei fester Kamera
    if (next && opts.camera === 'fixed') {
      const x0 = footX[s][i0], x1 = footX[next.side][next.i0];
      st.stepLenM = Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(mPerPx) ? Math.abs(x1 - x0) * mPerPx : NaN;
      st.speedMs = Number.isFinite(st.stepLenM) ? st.stepLenM / (st.stepTimeMs / 1000) : NaN;
    } else { st.stepLenM = NaN; st.speedMs = NaN; }
    return st;
  });

  // ---------- Blickwinkel ----------
  // Von der Seite gefilmt erscheinen Schultern und Hüfte schmal (≈ 0,1–0,25 der Rumpflänge), von vorne breit.
  // Schräg gefilmte Schritte verfälschen Winkel – sie zählen für Winkel nicht, Zeiten bleiben gültig.
  const viewAt = (i) => {
    const a = at(LM.lSh, i), b = at(LM.rSh, i), c = at(LM.lHip, i), d = at(LM.rHip, i);
    if (!a || !b || !c || !d) return NaN;
    const t = Math.hypot((a[0] + b[0] - c[0] - d[0]) / 2, (a[1] + b[1] - c[1] - d[1]) / 2);
    return t > 0 ? (Math.hypot(a[0] - b[0], a[1] - b[1]) + Math.hypot(c[0] - d[0], c[1] - d[1])) / 2 / t : NaN;
  };
  const views = [];
  steps.forEach((st) => { const v = []; for (let i = st.i0; i <= st.i1; i++) v.push(viewAt(i)); st.view = median(v); st.oblique = st.view > 0.4; if (Number.isFinite(st.view)) views.push(st.view); });
  const viewRatio = median(views), obliqueShare = views.length ? views.filter((v) => v > 0.4).length / views.length : 0;

  // ---------- Hürden im Video erkennen (Rhythmus) ----------
  // Überquerung = Flugphase deutlich länger als üblich. Gezählt werden Bodenkontakte zwischen zwei Überquerungen.
  const flights = steps.map((x) => x.flightMs).filter(Number.isFinite);
  const medF = median(flights);
  const clearances = [];
  steps.forEach((x, k) => { if (Number.isFinite(x.flightMs) && x.flightMs > Math.max(1.8 * medF, 160) && x.flightMs < 650 && contacts[k + 1]) { x.clearance = true; clearances.push(k); } });
  const rhythm = clearances.length >= 1 ? { clearances: clearances.map((k) => ({ step: k + 1, takeoffSide: steps[k].side, flightMs: steps[k].flightMs })), between: clearances.slice(1).map((k, j) => k - clearances[j]) } : null;

  // ---------- Kamerabewegung ----------
  // Im Stütz steht der Fuß still – seine Bildbewegung ist die Kamerabewegung.
  // camOff[i] verschiebt Bild-x in eine feste „Bahn-x“ (worldX = x + camOff[i]).
  let camOff = new Array(n).fill(0), camMoved = false;
  if (contacts.length) {
    const slope = new Array(n).fill(NaN), off = new Array(n).fill(0);
    for (const c of contacts) {
      const cut = Math.max(1, Math.round(0.15 * (c.i1 - c.i0 + 1))), ax = [], ay = [];
      for (let i = c.i0 + cut; i <= c.i1 - cut; i++) { const t = at(SIDES[c.side].toe, i); const x = t ? t[0] : footX[c.side][i]; if (Number.isFinite(x)) { ax.push(i); ay.push(x); } }
      if (ax.length < 2) { const a = footX[c.side][c.i0], b = footX[c.side][c.i1]; if (Number.isFinite(a) && Number.isFinite(b) && c.i1 > c.i0) { ax.push(c.i0, c.i1); ay.push(a, b); } else continue; }
      const mx = mean(ax), my = mean(ay); let sxy = 0, sxx = 0; ax.forEach((x, j) => { sxy += (x - mx) * (ay[j] - my); sxx += (x - mx) ** 2; });
      const b = sxx ? sxy / sxx : 0; for (let i = c.i0; i <= c.i1; i++) slope[i] = -b;
    }
    let last = -1;
    for (let i = 0; i < n; i++) if (Number.isFinite(slope[i])) { if (last >= 0 && i - last > 1) for (let j = last + 1; j < i; j++) slope[j] = slope[last] + (slope[i] - slope[last]) * (j - last) / (i - last); else if (last < 0) for (let j = 0; j < i; j++) slope[j] = slope[i]; last = i; }
    if (last >= 0) for (let j = last + 1; j < n; j++) slope[j] = slope[last];
    for (let i = 1; i < n; i++) off[i] = off[i - 1] + (Number.isFinite(slope[i]) ? slope[i] : 0);
    // Wie weit wandert ein Fuß im Stütz durchs Bild? Bei Stativ ≈ 0.
    const drift = median(contacts.filter((c) => c.i1 - c.i0 >= 2).map((c) => Math.abs((slope[c.i0] || 0) * (c.i1 - c.i0))));
    const range = Math.max(...off) - Math.min(...off);
    camMoved = (Number.isFinite(legPx) && range > 0.6 * legPx && drift > 0.06 * legPx) || !!zoomK;
    if (opts.camera === 'pan' || camMoved) camOff = off;
  }
  const wx = (x, i) => x + camOff[i];
  // Stativ eingestellt, aber die Kamera lief mit: Schrittlänge und Tempo über die Kamerabewegung korrigieren
  if (opts.camera === 'fixed' && camMoved) steps.forEach((st, k) => {
    const c = contacts[k], nx = contacts[k + 1]; if (!nx) return;
    const x0 = footX[c.side][c.i0], x1 = footX[nx.side][nx.i0];
    st.stepLenM = Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(mPerPx) ? Math.abs(wx(x1, nx.i0) - wx(x0, c.i0)) * mPerPx : NaN;
    st.speedMs = Number.isFinite(st.stepLenM) ? st.stepLenM / (st.stepTimeMs / 1000) : NaN;
  });

  // ---------- Hürden ----------
  const hurdleMarks = (opts.mode === 'hurdle' ? (opts.hurdles && opts.hurdles.length ? opts.hurdles : opts.hurdle ? [{ nr: 1, ...opts.hurdle }] : []) : []);
  const hurdles = [];
  const fw = (c, i) => wx(footX[c.side][i], i);
  const usedClr = new Set();
  const runHipBefore = (k) => median(contacts.slice(Math.max(0, k - 3), k).flatMap((c) => { const a = []; for (let i = c.i0; i <= c.i1; i++) if (hipMid[i]) a.push(hipMid[i][1]); return a; }));
  function hurdleMetrics(H1, to, ld, hxW, hyBar) {
    const kTo = contacts.indexOf(to), kLd = contacts.indexOf(ld);
    const stTO = steps[kTo], stLD = steps[kLd];
    H1.found = true;
    H1.flightMs = stTO && Number.isFinite(stTO.flightMs) ? stTO.flightMs : (ld.i0 - to.i1 - 1) * dt * 1000;
    H1.contactTOMs = stTO ? stTO.contactMs : NaN;
    H1.contactLDMs = stLD ? stLD.contactMs : NaN;
    H1.leanTODeg = stTO ? stTO.bodyLeanTO : NaN;
    const okX = (c, i) => Number.isFinite(footX[c.side][i]);
    H1.strideCm = okX(to, to.i1) && okX(ld, ld.i0) ? cm(dir * (fw(ld, ld.i0) - fw(to, to.i1))) : NaN;
    if (Number.isFinite(hxW)) {
      const tk = cm(dir * (hxW - fw(to, to.i1))), lc = cm(dir * (fw(ld, ld.i0) - hxW));
      if (tk > 30 && tk < 450 && lc > -10 && lc < 320) { H1.takeoffCm = tk; H1.landingCm = lc; H1.takeoffPct = (100 * tk) / (tk + lc); }
      else H1.warn = 'Absprung- und Landedistanz unsicher: Die Markierung passt nicht genau zu dieser Überquerung. Hürde im Bild kurz vor dem Angriff neu markieren.';
    }
    const pv = contacts[kTo - 1], nx = contacts[kLd + 1];
    H1.lastStepCm = pv && okX(pv, pv.i0) && okX(to, to.i0) ? cm(dir * (fw(to, to.i0) - fw(pv, pv.i0))) : NaN;
    H1.firstStepCm = nx && okX(nx, nx.i0) && okX(ld, ld.i0) ? cm(dir * (fw(nx, nx.i0) - fw(ld, ld.i0))) : NaN;
    let minHipY = Infinity, iTop = -1, cross = -1;
    for (let i = to.i1; i <= ld.i0; i++) if (hipMid[i]) {
      if (hipMid[i][1] < minHipY) { minHipY = hipMid[i][1]; iTop = i; }
      if (Number.isFinite(hxW) && cross < 0 && dir * (wx(hipMid[i][0], i) - hxW) >= 0) cross = i;
    }
    if (cross < 0) cross = iTop >= 0 ? iTop : Math.round((to.i1 + ld.i0) / 2);
    const runHip = runHipBefore(kTo);
    if (Number.isFinite(hyBar)) H1.hipOverBarCm = cm(hyBar - minHipY);
    H1.hipRiseCm = cm(runHip - minHipY);
    if (Number.isFinite(hxW) && iTop >= 0 && !H1.warn) H1.peakPosCm = cm(dir * (wx(hipMid[iTop][0], iTop) - hxW));
    H1.trunkOverDeg = trunk(cross);
    const k2 = Math.min(ld.i0, to.i1 + Math.max(2, Math.round(0.04 * fps)));
    const ha = hipMid[to.i1], hb = hipMid[k2];
    H1.takeoffAngleDeg = ha && hb && k2 > to.i1 ? Math.atan2(ha[1] - hb[1], Math.max(1e-6, dir * (wx(hb[0], k2) - wx(ha[0], to.i1)))) * 180 / Math.PI : NaN;
    const lead = to.side === 'L' ? 'R' : 'L', trail = to.side;
    let kMax = NaN, iLead = -1;
    for (let i = to.i1; i <= Math.max(cross, to.i1 + 1); i++) {
      const h = at(SIDES[lead].hip, i), k = at(SIDES[lead].knee, i), a = at(SIDES[lead].ank, i);
      if (h && k && a) { const v = jointAngle(h, k, a); if (!(v <= kMax)) { kMax = v; iLead = i; } }
    }
    H1.leadKneeDeg = kMax;
    const th = at(SIDES[trail].hip, cross), tkn = at(SIDES[trail].knee, cross);
    H1.trailThighDeg = th && tkn ? Math.atan2(tkn[1] - th[1], Math.max(1, Math.abs(tkn[0] - th[0]))) * 180 / Math.PI : NaN;
    H1.takeoffSide = to.side; H1.takeoffIndex = to.i1; H1.landingIndex = ld.i0; H1.crossIndex = cross; H1.leadIndex = iLead; H1.topIndex = iTop;
    if (stTO) { stTO.hurdleRole = `Absprung H${H1.nr}`; stTO.hurdleStep = true; }
    if (stLD) { stLD.hurdleRole = `Landung H${H1.nr}`; stLD.hurdleStep = true; }
  }
  const marks = hurdleMarks.map((hm) => ({ ...hm, i: Number.isFinite(hm.i) ? Math.max(0, Math.min(n - 1, Math.round(hm.i))) : 0 })).sort((a, b) => a.i - b.i);
  for (const hm of marks) {
    const hp = rotatePt(zpt(hm.x * W, hm.y * H, hm.i), tilt, W, H);
    const hxW = wx(hp[0], hm.i), hyBar = hp[1];
    const H1 = { nr: hm.nr ?? hurdles.length + 1, markIndex: hm.i, xW: hxW, yBar: hyBar, found: false };
    hurdles.push(H1);
    // 1. Zeitlich: erste lange Flugphase ab kurz vor dem markierten Bild (robust, auch wenn die Kamera mitläuft)
    const tol = Math.round(0.35 * fps);
    // unter den langen Flugphasen kurz nach der Markierung die längste (echte Überquerung statt verpasstem Schritt)
    const cands = clearances.filter((kc) => !usedClr.has(kc) && contacts[kc].i1 >= hm.i - tol && contacts[kc].i1 <= hm.i + Math.round(1.2 * fps));
    let k = cands.find((kc) => steps[kc].flightMs >= 240);
    if (k == null && cands.length) k = cands.reduce((a, b) => (steps[b].flightMs > steps[a].flightMs ? b : a));
    // 2. Räumlich als Rückfall: letzter Kontakt vor der Hürde
    if (k == null) {
      const before = contacts.filter((c) => Number.isFinite(footX[c.side][c.i1]) && dir * (fw(c, c.i1) - hxW) < 0 && Math.abs(c.i1 - hm.i) < 2.5 * fps);
      const to = before[before.length - 1]; if (to && contacts[contacts.indexOf(to) + 1]) k = contacts.indexOf(to);
    }
    if (k == null) { H1.reason = 'Keine Überquerung in der Nähe dieser Markierung gefunden. Liegt der Absprung im Ausschnitt? Markierung kurz vor dem Angriff setzen.'; continue; }
    usedClr.add(k);
    hurdleMetrics(H1, contacts[k], contacts[k + 1], hxW, hyBar);
  }
  // Ohne Markierung: lange Flugphasen als Hürden zählen (Zeiten, Hürdenschritt, Winkel – aber keine Distanz zur Hürde)
  if (opts.mode === 'hurdle' && !marks.length) {
    // Ohne Markierung nur echte Überquerungen: lange Flugphase UND die Hüfte steigt deutlich (sonst eher ein verpasster Schritt oder der Start).
    // Passt eine lange Flugphase genau in den Hürdenrhythmus (gleicher Abstand zur Hürde davor und danach), zählt sie auch ohne deutlichen Hüftanstieg.
    const cand = clearances.map((k) => { const H1 = { auto: true, found: false }; hurdleMetrics(H1, contacts[k], contacts[k + 1], NaN, NaN); return { k, H1 }; });
    const ok1 = (H1) => Number.isFinite(H1.hipRiseCm) && H1.hipRiseCm >= 7 && H1.hipRiseCm < 60 && H1.flightMs >= 240 && !(H1.contactLDMs < 40);
    const acc = new Set(cand.filter((c) => ok1(c.H1)).map((c) => c.k));
    for (const c of cand) {
      if (acc.has(c.k) || !(c.H1.flightMs >= 240)) continue;
      for (let d = 2; d <= 8; d++) if ((acc.has(c.k - d) && acc.has(c.k + d)) || (acc.has(c.k + d) && acc.has(c.k + 2 * d)) || (acc.has(c.k - d) && acc.has(c.k - 2 * d))) { acc.add(c.k); break; }
    }
    let nr = 0;
    for (const c of cand) {
      if (acc.has(c.k)) { c.H1.nr = ++nr; hurdles.push(c.H1); }
      else { const a = steps[c.k], b2 = steps[c.k + 1]; if (a) { a.hurdleRole = null; a.hurdleStep = false; } if (b2) { b2.hurdleRole = null; b2.hurdleStep = false; } }
    }
    // Rollen-Beschriftung mit endgültiger Nummer
    hurdles.forEach((h) => { const st = steps.find((x) => x.i1 === h.takeoffIndex), sl = steps.find((x) => x.i0 === h.landingIndex); if (st) st.hurdleRole = `Absprung H${h.nr}`; if (sl) sl.hurdleRole = `Landung H${h.nr}`; });
  }


  hurdles.sort((a, b) => a.nr - b.nr);
  const hurdle = hurdles.length ? (hurdles.find((h) => h.found) || { found: false }) : null;

  // ---------- Tempo- und Kraftverlauf (Schätzung) ----------
  // Horizontal: Im Stütz steht der Fuß still – die Hüfte relativ zum Fuß ergibt das echte Lauftempo,
  // auch bei mitschwenkender Kamera. In der Flugphase wird zwischen den Kontakten verbunden.
  // Vertikal: Beschleunigung der Hüfte -> Bodenreaktionskraft in Körpergewichten (F/m = g + a).
  const curves = { t: [], v: [], f: [], ok: Number.isFinite(mPerPx) };
  if (curves.ok) {
    const vx = new Array(n).fill(NaN);
    for (const c of contacts) {
      const S = SIDES[c.side];
      // Rand des Stützes auslassen (Fuß setzt noch auf / rollt ab) – nur der ruhige Teil dient als Anker
      const cut = Math.max(1, Math.round(0.15 * (c.i1 - c.i0 + 1)));
      // Der Fuß steht im Stütz still -> Anker als Gerade durch seine Bildposition (glättet Rauschen, folgt einem Kameraschwenk)
      const ax = [], ay = [];
      for (let i = c.i0 + cut; i <= c.i1 - cut; i++) { const t = at(S.toe, i); const x = t ? t[0] : footX[c.side][i]; if (Number.isFinite(x)) { ax.push(i); ay.push(x); } }
      let fa = NaN, fb = 0;
      if (ax.length >= 2) { const mx = mean(ax), my = mean(ay); let sxy = 0, sxx = 0; ax.forEach((x, j) => { sxy += (x - mx) * (ay[j] - my); sxx += (x - mx) ** 2; }); fb = sxx ? sxy / sxx : 0; fa = my - fb * mx; }
      const anc = (i) => (Number.isFinite(fa) ? fa + fb * i : NaN);
      for (let i = c.i0 + cut; i <= c.i1 - cut; i++) {
        const a = i - 1, b = i + 1;
        if (b === a || !hipMid[a] || !hipMid[b]) continue;
        const ra = hipMid[a][0] - anc(a), rb = hipMid[b][0] - anc(b);
        if (Number.isFinite(ra) && Number.isFinite(rb)) vx[i] = dir * (rb - ra) / (b - a) * mPerPx * fps;
      }
    }
    // Lücken (Flug) linear füllen, dann glätten (~25 ms)
    let last = -1;
    for (let i = 0; i < n; i++) if (Number.isFinite(vx[i])) { if (last >= 0 && i - last > 1) for (let j = last + 1; j < i; j++) vx[j] = vx[last] + (vx[i] - vx[last]) * (j - last) / (i - last); last = i; }
    const sm = (arr, hw) => arr.map((_, i) => { let t = 0, k = 0; for (let j = i - hw; j <= i + hw; j++) if (j >= 0 && j < n && Number.isFinite(arr[j])) { t += arr[j]; k++; } return k ? t / k : NaN; });
    const hw = Math.max(1, Math.round(0.0125 * fps));
    const vS = sm(vx, hw);
    const yh = hipMid.map((p) => (p ? -p[1] * mPerPx : NaN)), yS = sm(sm(yh, hw), hw);
    const f = new Array(n).fill(NaN);
    for (let i = 1; i < n - 1; i++) if (Number.isFinite(yS[i - 1]) && Number.isFinite(yS[i]) && Number.isFinite(yS[i + 1])) f[i] = 1 + ((yS[i + 1] - 2 * yS[i] + yS[i - 1]) * fps * fps) / 9.81;
    const fS = sm(f, hw);
    curves.t = vS.map((_, i) => i / fps); curves.v = vS; curves.f = fS;
    // pro Schritt: Tempogewinn im Stütz (Abdruck minus Bremsen) und mittlere/maximale Vertikalkraft
    steps.forEach((st) => {
      const a = st.i0, b = st.i1, cut = Math.max(1, Math.round(0.15 * (b - a + 1)));
      // Tempogewinn: Steigung einer Ausgleichsgeraden über den ruhigen Teil des Stützes × Stützdauer (robust gegen Rauschen)
      const xsF = [], ysF = [];
      for (let i = a + cut; i <= b - cut; i++) if (Number.isFinite(vx[i])) { xsF.push(i); ysF.push(vx[i]); }
      let slope = NaN;
      if (xsF.length >= 3) { const mx = mean(xsF), my = mean(ysF); let sxy = 0, sxx = 0; xsF.forEach((x, j) => { sxy += (x - mx) * (ysF[j] - my); sxx += (x - mx) ** 2; }); slope = sxx ? sxy / sxx : NaN; }
      let vmin = Infinity, fsum = 0, fc = 0, fmax = -Infinity;
      for (let i = a; i <= b; i++) { if (Number.isFinite(fS[i])) { fsum += fS[i]; fc++; fmax = Math.max(fmax, fS[i]); } }
      for (let i = a + cut; i <= Math.round((a + b) / 2); i++) if (Number.isFinite(vS[i])) vmin = Math.min(vmin, vS[i]);
      const v0 = vS[a + cut];
      st.vTD = v0; st.vGain = Number.isFinite(slope) ? slope * (b - a + 1) : NaN;
      st.vBrake = Number.isFinite(v0) && Number.isFinite(vmin) ? Math.min(0, vmin - v0) : NaN;
      st.fMean = fc ? fsum / fc : NaN; st.fPeak = Number.isFinite(fmax) ? fmax : NaN;
    });
  }

  // ---------- Rhythmus-Prüfung ----------
  // Laufschritte kommen gleichmäßig: Schrittdauer, Kontakt und Flug ändern sich von Schritt zu Schritt nur wenig
  // (außer an der Hürde). Ein Schritt, der deutlich aus der Reihe seiner Nachbarn fällt, ist fast immer falsch erkannt –
  // er bleibt sichtbar, zählt aber nicht in die Auswertung.
  if (!forced) {
    const normal = (x) => x.include && !x.hurdleStep && !x.clearance && !x.partial;
    const loc = (key, k) => { const v = []; for (let j = Math.max(0, k - 4); j <= Math.min(steps.length - 1, k + 4); j++) if (j !== k && normal(steps[j]) && Number.isFinite(steps[j][key])) v.push(steps[j][key]); return v.length >= 3 ? median(v) : NaN; };
    const out = [];
    steps.forEach((x, k) => {
      if (!normal(x)) return;
      const mT = loc('stepTimeMs', k), mC = loc('contactMs', k), mF = loc('flightMs', k), why = [];
      if (Number.isFinite(mT) && Number.isFinite(x.stepTimeMs) && Math.abs(x.stepTimeMs - mT) > 0.22 * mT) why.push('Schrittdauer');
      if (Number.isFinite(mC) && Number.isFinite(x.contactMs) && Math.abs(x.contactMs - mC) > Math.max(25, 0.35 * mC)) why.push('Kontakt');
      if (Number.isFinite(mF) && Number.isFinite(x.flightMs) && Math.abs(x.flightMs - mF) > Math.max(35, 0.45 * mF)) why.push('Flug');
      if (why.length) out.push([x, why]);
    });
    // nur wenn die Mehrheit der Schritte zusammenpasst – sonst ist der ganze Lauf unsicher und es gibt keinen verlässlichen Rhythmus
    if (out.length <= 0.4 * steps.filter(normal).length) for (const [x, why] of out) { x.include = false; x.rhythmOut = true; x.flags.push('passt nicht zum Rhythmus (' + why.join(', ') + ')'); }
  }

  // Bildqualität
  const vis = [];
  for (const f of frames) if (f && f.lm) vis.push(mean(f.lm.map((p) => p[2] ?? 1)));
  const detected = frames.filter((f) => f && f.lm).length;

  return {
    dir, mPerPx, legPx, fps, n, useSpeed, tilt, tiltSource, groundLine, W, H,
    dbg: dbg ? { ...dbg, ground, mL: Array.from({ length: n }, (_, i) => margin('L', i)), mR: Array.from({ length: n }, (_, i) => margin('R', i)) } : null,
    viewRatio, obliqueShare, motionStart, tooSmall: opts._tooSmall || 0,
    contacts, steps, hurdle, hurdles, camOff, camMoved, zoomK, zoomRatio: zn ? zn.ratio : 1,
    ground, groundTol: tol,
    quality: { detectedPct: n ? (100 * detected) / n : 0, meanVis: mean(vis), swaps: P.stats.swaps, outliers: P.stats.outliers, outlierPct: P.stats.outlierPct },
    // Grenzen der Aufnahme: Bei wenigen Bildern pro Sekunde oder einer sehr kleinen Person sind Kontakt- und Flugzeiten
    // (nur 2–3 Bilder pro Kontakt, Füße wenige Pixel groß) bzw. Winkel nicht belastbar – sie werden dann nicht zusammengefasst.
    limits: { lowFps: fps < 50, smallPx: Number.isFinite(legPx) && legPx < 55, legPx: Math.round(legPx || 0), personPct: Number.isFinite(legPx) ? Math.round(100 * legPx / 0.49 / Math.max(W, H)) : 0 },
    smoothed: P, curves, rhythm, scaleSource, recoveredCount: recovered.length, edited: !!forced,
  };
}

// Kennzahlen, über die zusammengefasst wird
export const METRICS = [
  { key: 'contactMs', label: 'Bodenkontaktzeit', unit: 'ms', digits: 0 },
  { key: 'flightMs', label: 'Flugzeit', unit: 'ms', digits: 0 },
  { key: 'cadenceHz', label: 'Schrittfrequenz', unit: 'Schritte/s', digits: 2 },
  { key: 'stepLenM', label: 'Schrittlänge', unit: 'm', digits: 2, fixedOnly: true },
  { key: 'speedMs', label: 'Tempo (Video)', unit: 'm/s', digits: 2, fixedOnly: true },
  { key: 'touchdownCm', label: 'Aufsetzen vor der Hüfte (minus = hinter der Hüfte)', unit: 'cm', digits: 0 },
  { key: 'shinTD', label: 'Unterschenkel beim Aufsetzen (Knie vor Knöchel +)', unit: '°', digits: 0 },
  { key: 'footAngleTD', label: 'Fußwinkel beim Aufsetzen (+ = Ferse zuerst)', unit: '°', digits: 0 },
  { key: 'ankleTD', label: 'Sprunggelenk beim Aufsetzen (Knie–Knöchel–Zehen)', unit: '°', digits: 0 },
  { key: 'kneeTD', label: 'Kniewinkel beim Aufsetzen', unit: '°', digits: 0 },
  { key: 'kneeMinStance', label: 'Kniewinkel min. im Stütz', unit: '°', digits: 0 },
  { key: 'thighSepTD', label: 'Oberschenkel-Spreizung beim Aufsetzen', unit: '°', digits: 0 },
  { key: 'kneeLiftDeg', label: 'Kniehub (Oberschenkel vor Senkrechter)', unit: '°', digits: 0 },
  { key: 'hipExtTO', label: 'Hüftstreckung beim Abdruck', unit: '°', digits: 0 },
  { key: 'kneeTO', label: 'Kniewinkel beim Abdruck', unit: '°', digits: 0 },
  { key: 'trunkDeg', label: 'Rumpfneigung (Mittel, vorne +)', unit: '°', digits: 1 },
  { key: 'bodyLeanTO', label: 'Körpervorlage beim Abdruck (Fuß–Schulter)', unit: '°', digits: 0 },
  { key: 'hipKinkTO', label: 'Linie Fuß–Hüfte–Schulter beim Abdruck (0 = gerade, + = Hüfte knickt ein)', unit: '°', digits: 0 },
  { key: 'hipFlexMid', label: 'Hüftbeugung in der Stützmitte (0 = Rumpf und Oberschenkel in Linie)', unit: '°', digits: 0 },
  { key: 'hipHeightMid', label: 'Hüfthöhe in der Stützmitte (% der Hüfthöhe im Stand)', unit: '%', digits: 0 },
  { key: 'vertOscCm', label: 'Vertikale Hüftbewegung', unit: 'cm', digits: 1 },
  { key: 'armFwdDeg', label: 'Arm nach vorne (Oberarm vor Senkrechter)', unit: '°', digits: 0 },
  { key: 'armBackDeg', label: 'Arm nach hinten (Oberarm hinter Senkrechter)', unit: '°', digits: 0 },
  { key: 'elbowFrontDeg', label: 'Ellbogenwinkel vorne', unit: '°', digits: 0 },
  { key: 'elbowBackDeg', label: 'Ellbogenwinkel hinten', unit: '°', digits: 0 },
  { key: 'armAsymDeg', label: 'Arm-Asymmetrie links/rechts', unit: '°', digits: 0 },
  { key: 'armRangeDeg', label: 'Armamplitude', unit: '°', digits: 0 },
  { key: 'vGain', label: 'Tempogewinn pro Stütz (Schätzung)', unit: 'm/s', digits: 2 },
  { key: 'vBrake', label: 'Bremsen nach dem Aufsetzen (Schätzung)', unit: 'm/s', digits: 2 },
  { key: 'fMean', label: 'Mittlere Vertikalkraft im Stütz (Schätzung)', unit: '× KG', digits: 1 },
  { key: 'elbowDeg', label: 'Ellbogenwinkel (Mittel)', unit: '°', digits: 0 },
];
export const HURDLE_METRICS = [
  { key: 'takeoffCm', label: 'Absprungdistanz vor der Hürde', unit: 'cm', digits: 0 },
  { key: 'landingCm', label: 'Landedistanz hinter der Hürde', unit: 'cm', digits: 0 },
  { key: 'strideCm', label: 'Hürdenschritt gesamt (Absprung + Landung)', unit: 'cm', digits: 0 },
  { key: 'takeoffPct', label: 'Anteil Absprung am Hürdenschritt', unit: '%', digits: 0 },
  { key: 'flightMs', label: 'Flugzeit über die Hürde', unit: 'ms', digits: 0, better: 'low' },
  { key: 'contactTOMs', label: 'Bodenkontakt beim Absprung', unit: 'ms', digits: 0, better: 'low' },
  { key: 'contactLDMs', label: 'Bodenkontakt bei der Landung', unit: 'ms', digits: 0, better: 'low' },
  { key: 'lastStepCm', label: 'Letzter Schritt vor dem Absprung', unit: 'cm', digits: 0 },
  { key: 'firstStepCm', label: 'Erster Schritt nach der Landung', unit: 'cm', digits: 0 },
  { key: 'takeoffAngleDeg', label: 'Absprungwinkel (Hüftweg gegen die Waagrechte)', unit: '°', digits: 0, better: 'low' },
  { key: 'leanTODeg', label: 'Körpervorlage beim Absprung (Fuß–Schulter)', unit: '°', digits: 0 },
  { key: 'leadKneeDeg', label: 'Schwungbein: max. Kniestreckung zur Hürde (180 = gestreckt)', unit: '°', digits: 0 },
  { key: 'trailThighDeg', label: 'Nachziehbein über der Hürde: Oberschenkel zur Waagrechten', unit: '°', digits: 0, better: 'low' },
  { key: 'trunkOverDeg', label: 'Rumpfneigung über der Hürde', unit: '°', digits: 0 },
  { key: 'hipOverBarCm', label: 'Hüfte über Hürdenoberkante', unit: 'cm', digits: 0 },
  { key: 'hipRiseCm', label: 'Hüftanstieg ggü. Laufhöhe', unit: 'cm', digits: 0, better: 'low' },
  { key: 'peakPosCm', label: 'Höchster Hüftpunkt relativ zur Hürde (minus = davor)', unit: 'cm', digits: 0 },
];

// Links/Rechts: Mittelwerte je Standbein und Asymmetrie in Prozent
export function summarizeLR(result) {
  const inc = result.steps.filter((s) => s.include && !s.hurdleStep);
  const out = {};
  for (const m of METRICS) {
    const L = mean(inc.filter((s) => s.side === 'L').map((s) => s[m.key])), R = mean(inc.filter((s) => s.side === 'R').map((s) => s[m.key]));
    if (!Number.isFinite(L) || !Number.isFinite(R)) continue;
    const base = (Math.abs(L) + Math.abs(R)) / 2;
    out[m.key] = { L, R, asymPct: base > 1e-6 ? ((R - L) / base) * 100 : 0 };
  }
  return out;
}
export function transitionStep(result) {
  // erster Schritt, bei dem die Flugzeit länger ist als die Kontaktzeit (Übergang Beschleunigung -> aufrecht)
  const st = result.steps.find((s) => s.include && Number.isFinite(s.flightMs) && Number.isFinite(s.contactMs) && s.flightMs > s.contactMs);
  return st ? st.index : null;
}
const VIEW_SENSITIVE = (m) => m.unit === '°' || ['touchdownCm', 'hipHeightMid', 'vertOscCm', 'stepLenM', 'speedMs'].includes(m.key);
export function summarize(result) {
  const inc = result.steps.filter((s) => s.include && !s.hurdleStep);
  const side = inc.filter((s) => !s.oblique);
  const out = {};
  const lim = result.limits || {}, TIMING = ['contactMs', 'flightMs', 'vGain', 'vBrake', 'fMean', 'fPeak'];
  const blocked = (key, unit) => ((lim.lowFps || lim.smallPx) && TIMING.includes(key)) || (lim.smallPx && (unit === '°' || ['speedMs', 'stepLenM', 'touchdownCm', 'vertOscCm', 'hipHeightMid'].includes(key)));
  for (const m of METRICS) out[m.key] = blocked(m.key, m.unit) ? NaN : median((VIEW_SENSITIVE(m) ? side : inc).map((s) => s[m.key]));
  out.steps = inc.length;
  const hf = (result.hurdles || (result.hurdle ? [result.hurdle] : [])).filter((h) => h && h.found);
  if (hf.length) { for (const m of HURDLE_METRICS) out['h_' + m.key] = (/^contact(TO|LD)Ms$/.test(m.key) ? blocked('contactMs', '') : m.unit === '°' && blocked('x', '°')) ? NaN : median(hf.map((h) => h[m.key])); out.h_count = hf.length; }
  return out;
}

// ---------- Laufphasen & Referenzbereiche ----------
// Grobe Orientierungswerte aus der Sprint-Biomechanik-Literatur (u. a. Mann; Nagahara et al.; Hunter et al.).
// Bewusst breite Bereiche – individuelle Abstimmung mit dem Trainer bleibt nötig.
export const PHASES = [
  { id: 'start', label: 'Start / erste Schritte', short: 'Start' },
  { id: 'accel', label: 'Beschleunigung', short: 'Beschleunigung' },
  { id: 'maxv', label: 'Maximaltempo (aufrecht)', short: 'Maximaltempo' },
];
// lo/hi = guter Bereich; low/high = Tipp, wenn darunter/darüber
export const REF = {
  maxv: {
    contactMs: { lo: 80, hi: 125, high: 'Kontakt lang: steifere Fußgelenke, aktiv „greifen“, Fuß näher unter dem Körper aufsetzen.' },
    flightMs: { lo: 100, hi: 150 },
    touchdownCm: { lo: 15, hi: 38, high: 'Fuß setzt weit vor der Hüfte auf – bremst jeden Schritt. Aktiver von oben nach unten-hinten aufsetzen.', low: 'Sehr nah unter dem Körper – gut, solange die Schrittlänge nicht leidet.' },
    shinTD: { lo: -12, hi: 6, low: 'Unterschenkel beim Aufsetzen stark nach vorne gestreckt (Fuß weit vor dem Knie) – typisch fürs „Ausschreiten“.' },
    kneeTD: { lo: 148, hi: 168 },
    kneeLiftDeg: { lo: 65, hi: 95, low: 'Knie kommt vorne nicht hoch genug – mehr Front-Side-Mechanik.' },
    hipExtTO: { lo: 10, hi: 30, high: 'Bein bleibt hinten lange gestreckt – bei Maximaltempo schneller nach vorne zurückholen.' },
    trunkDeg: { lo: 0, hi: 12, high: 'Rumpf bei Maximaltempo noch deutlich vorgeneigt – aufrichten, Hüfte hoch.', low: 'Rumpf nach hinten geneigt – „Sitzen“, Körperspannung halten.' },
    bodyLeanTO: { lo: 5, hi: 20 },
    hipFlexMid: { lo: 5, hi: 30, high: 'Hüfte in der Stützmitte stark gebeugt – „Sitzen“. Becken hoch und nach vorne, Rumpf und Standbein möglichst in einer Linie.' },
    hipHeightMid: { lo: 91, hi: 101, low: 'Hüfte sinkt im Stütz tief ab („Sitzen“) – hoch laufen, steifer im Fußgelenk und Knie aufsetzen.' },
    vertOscCm: { lo: 3, hi: 8, high: 'Viel Auf und Ab – Energie geht nach oben statt nach vorne.' },
    footAngleTD: { lo: -18, hi: 4, high: 'Aufsetzen über die Ferse – beim Sprint auf dem Vorfuß bzw. Ballen aufsetzen.' },
    armFwdDeg: { lo: 35, hi: 75 },
    armBackDeg: { lo: 25, hi: 65 },
    elbowFrontDeg: { lo: 60, hi: 110 },
    elbowBackDeg: { lo: 90, hi: 160 },
    armAsymDeg: { lo: 0, hi: 15, high: 'Arme schwingen ungleich weit – auf beidseitig gleichen Armzug achten.' },
  },
  accel: {
    contactMs: { lo: 110, hi: 170 },
    flightMs: { lo: 50, hi: 120 },
    touchdownCm: { lo: -15, hi: 15, high: 'In der Beschleunigung sollte der Fuß unter oder knapp hinter der Hüfte aufsetzen – sonst bremst er.' },
    shinTD: { lo: 15, hi: 50, low: 'Unterschenkel beim Aufsetzen zu steil/nach vorne gestreckt – in der Beschleunigung „schiebt“ ein nach vorne geneigtes Schienbein besser.' },
    kneeLiftDeg: { lo: 50, hi: 90 },
    hipExtTO: { lo: 25, hi: 50, low: 'Abdruck nicht vollständig gestreckt – kraftvoll durch die Hüfte drücken.' },
    kneeTO: { lo: 155, hi: 180 },
    footAngleTD: { lo: -25, hi: 2, high: 'Aufsetzen über die Ferse – in der Beschleunigung auf dem Ballen landen.' },
    trunkDeg: { lo: 15, hi: 45 },
    bodyLeanTO: { lo: 20, hi: 45, low: 'Wenig Körpervorlage für die Beschleunigung – zu früh aufgerichtet?' },
    hipKinkTO: { lo: -10, hi: 12, high: 'Vorlage kommt aus der Hüfte statt aus dem ganzen Körper – Körper als gerade Linie nach vorne „fallen“ lassen.' },
    armFwdDeg: { lo: 35, hi: 85 },
    armBackDeg: { lo: 30, hi: 75 },
    armAsymDeg: { lo: 0, hi: 15 },
  },
  start: {
    contactMs: { lo: 140, hi: 220 },
    touchdownCm: { lo: -35, hi: 0, high: 'Fuß setzt in den ersten Schritten vor der Hüfte auf – hinter dem Körper aufsetzen und schieben.' },
    shinTD: { lo: 30, hi: 60 },
    hipExtTO: { lo: 30, hi: 60 },
    kneeTO: { lo: 160, hi: 180, low: 'Bein beim Abdruck nicht gestreckt – voll durchdrücken.' },
    trunkDeg: { lo: 35, hi: 60 },
    bodyLeanTO: { lo: 38, hi: 60, low: 'Zu früh aufgerichtet – in den ersten Schritten flach bleiben.' },
    hipKinkTO: { lo: -10, hi: 14, high: 'Starker Hüftknick beim Abdruck – Linie Fuß–Hüfte–Schulter gerade halten.' },
    armAsymDeg: { lo: 0, hi: 20 },
  },
};
export const CATEGORIES = [
  { id: 'haltung', label: 'Haltung & Hüfte', keys: ['bodyLeanTO', 'hipKinkTO', 'hipFlexMid', 'hipHeightMid', 'trunkDeg', 'vertOscCm'], moment: 'to',
    info: 'Körpervorlage = Neigung der Linie vom Fuß zur Schulter beim Abdruck. In Start und Beschleunigung soll Fuß–Hüfte–Schulter dabei eine gerade Linie bilden (Vorlage aus dem ganzen Körper, nicht aus der abgeknickten Hüfte). Bei Maximaltempo zählt vor allem, dass man in der Stützmitte nicht „sitzt“ – die Hüfte bleibt hoch und gestreckt.' },
  { id: 'vorne', label: 'Vorderes Bein & Aufsetzen', keys: ['touchdownCm', 'shinTD', 'footAngleTD', 'ankleTD', 'kneeTD', 'kneeLiftDeg', 'thighSepTD', 'kneeMinStance'], moment: 'td',
    info: 'Wie und wo der Fuß aufsetzt. Fuß weit vor der Hüfte und nach vorne gestreckter Unterschenkel bremsen.' },
  { id: 'hinten', label: 'Hinteres Bein & Abdruck', keys: ['hipExtTO', 'kneeTO'], moment: 'to',
    info: 'Streckung beim Abdruck. In Start und Beschleunigung voll durchdrücken, bei Maximaltempo das Bein schnell wieder nach vorne holen.' },
  { id: 'arme', label: 'Arme', keys: ['armFwdDeg', 'armBackDeg', 'elbowFrontDeg', 'elbowBackDeg', 'armAsymDeg', 'armRangeDeg'], moment: 'arm',
    info: 'Armzug aus der Schulter, Ellbogen vorne eher gebeugt, hinten offener. Beide Seiten gleich weit.' },
  { id: 'rhythmus', label: 'Rhythmus & Tempo', keys: ['contactMs', 'flightMs', 'cadenceHz', 'stepLenM', 'speedMs', 'vGain', 'vBrake', 'fMean'], moment: null,
    info: 'Zeitliche Struktur: kurze Bodenkontakte und hohe Frequenz bei ausreichender Schrittlänge.' },
];

export function suggestPhase(sum) {
  const lean = Number.isFinite(sum.bodyLeanTO) ? sum.bodyLeanTO : sum.trunkDeg;
  if (!Number.isFinite(lean)) return 'maxv';
  if (lean >= 38) return 'start';
  if (lean >= 18 || (Number.isFinite(sum.contactMs) && sum.contactMs > 135)) return 'accel';
  return 'maxv';
}
// Bewertung eines Werts gegen den Referenzbereich der Phase
export function evaluate(key, v, phase) {
  const r = REF[phase] && REF[phase][key];
  if (!r || !Number.isFinite(v)) return { status: 'none', ref: r || null };
  const w = Math.max(1e-9, r.hi - r.lo);
  if (v >= r.lo && v <= r.hi) return { status: 'good', ref: r };
  const off = v < r.lo ? (r.lo - v) / w : (v - r.hi) / w;
  return { status: off <= 0.35 ? 'near' : 'off', ref: r, side: v < r.lo ? 'low' : 'high' };
}

export function hints(sum, mode, phase = 'maxv') {
  const h = [];
  const f = (v) => Number.isFinite(v);
  const label = (k) => (METRICS.find((m) => m.key === k) || {}).label || k;
  for (const k of Object.keys(REF[phase] || {})) {
    const e = evaluate(k, sum[k], phase);
    if (e.status === 'off' || e.status === 'near') {
      const tip = e.ref[e.side];
      if (!tip) continue;
      h.push({ level: e.status === 'off' ? 'warn' : 'info', metric: k, text: `${label(k)}: ${fmtN(sum[k])} (Richtwert ${e.ref.lo}–${e.ref.hi}). ${tip}` });
    }
  }
  const good = Object.keys(REF[phase] || {}).filter((k) => evaluate(k, sum[k], phase).status === 'good');
  if (good.length >= 3) h.push({ level: 'good', metric: null, text: `Im Richtbereich: ${good.slice(0, 5).map(label).map((l) => l.split(' (')[0]).join(', ')}${good.length > 5 ? ' …' : ''}.` });
  if (mode === 'hurdle') {
    if (f(sum.h_hipRiseCm) && sum.h_hipRiseCm > 25) h.push({ level: 'warn', metric: 'h_hipRiseCm', text: `Hüfte steigt über der Hürde ${sum.h_hipRiseCm.toFixed(0)} cm an – Hürde eher „übersprungen“ als überlaufen. Flacher angreifen.` });
    if (f(sum.h_takeoffPct) && sum.h_takeoffPct < 56) h.push({ level: 'info', metric: 'h_takeoffPct', text: `Absprung nur ${sum.h_takeoffPct.toFixed(0)} % des Hürdenschritts – eher nah an der Hürde. Üblich ist etwa 60/40 (Absprung länger als Landung).` });
    if (f(sum.h_peakPosCm) && sum.h_peakPosCm > 20) h.push({ level: 'info', metric: 'h_peakPosCm', text: `Höchster Hüftpunkt ${sum.h_peakPosCm.toFixed(0)} cm hinter der Hürde. Ideal liegt er kurz vor oder über der Hürde – früher angreifen.` });
    if (f(sum.h_contactLDMs) && f(sum.h_contactTOMs) && sum.h_contactLDMs > 1.4 * sum.h_contactTOMs) h.push({ level: 'info', metric: 'h_contactLDMs', text: 'Landekontakt deutlich länger als der Absprung – nach der Hürde aktiver „auf den Ballen“ landen und sofort weiterlaufen.' });
  }
  return h;
}
const fmtN = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',');

// ---------- Ein Doppelschritt für die animierte Figur ----------
// Speichert Gelenkpositionen (in m, relativ zur Hüftmitte, Laufrichtung +x, y nach oben über dem Boden) für einen
// vollständigen Doppelschritt, auf 48 Zeitpunkte normiert. Klein genug zum Speichern, reicht zum Vergleichen.
export const FIG_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 7, 8];
export function extractStride(result, samples = 48) {
  const P = result.smoothed, steps = result.steps, contacts = result.contacts, dir = result.dir, m = result.mPerPx;
  if (!P || !Number.isFinite(m)) return null;
  // mittlerer vollständiger Doppelschritt: Kontakt k bis Kontakt k+2
  const full = contacts.map((c, i) => ({ c, i })).filter(({ c, i }) => !c.partial && contacts[i + 2] && steps[i] && steps[i].include && !steps[i].hurdleStep && !(steps[i + 1] && steps[i + 1].hurdleStep));
  if (!full.length) return null;
  const { i: ci } = full[Math.floor((full.length - 1) / 2)];
  const a = contacts[ci].td, b = contacts[ci + 2].td;
  if (!(b > a)) return null;
  const n = P[0].length;
  const at = (k, t) => { const i0 = Math.floor(t), f = t - i0, p = P[k][Math.max(0, Math.min(n - 1, i0))], q = P[k][Math.max(0, Math.min(n - 1, i0 + 1))]; if (!p || !q) return p || q || null; return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; };
  const g = (t) => { const i0 = Math.max(0, Math.min(n - 1, Math.round(t))); return result.ground[i0]; };
  const frames = [], hx = [];
  let hc0 = null;
  for (let s = 0; s < samples; s++) {
    const t = a + (b - a) * (s / samples);
    const hl = at(23, t), hr = at(24, t);
    const hc = hl && hr ? [(hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2] : hl || hr;
    if (!hc) return null;
    if (!hc0) hc0 = hc;
    hx.push(Math.round(dir * (hc[0] - hc0[0]) * m * 1000) / 1000); // Vorwärtsweg der Hüfte (nur bei fester Kamera echt)
    const gy = g(t);
    frames.push(FIG_JOINTS.map((k) => { const p = at(k, t); if (!p) return null; return [Math.round(dir * (p[0] - hc[0]) * m * 1000) / 1000, Math.round((gy - p[1]) * m * 1000) / 1000]; }));
  }
  const norm = (t) => (t - a) / (b - a);
  const cts = [];
  for (let j = ci; j <= ci + 2 && j < contacts.length; j++) { const c = contacts[j]; cts.push({ side: c.side, a: Math.max(0, norm(c.td)), b: Math.min(1, norm(c.to)) }); }
  // welche Seite ist der Kamera zugewandt (besser sichtbar)?
  const travel = result.useSpeed ? hx : null;
  return { v: 3, samples, durationMs: (b - a) / result.fps * 1000, contacts: cts.filter((c) => c.b > 0 && c.a < 1), frames, hx: travel };
}

// Pearson-Korrelation + Regressionsgerade
export function correlate(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const n = pts.length;
  if (n < 3) return { n, r: NaN, slope: NaN, intercept: NaN };
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return { n, r: NaN, slope: NaN, intercept: NaN };
  const slope = sxy / sxx;
  return { n, r: sxy / Math.sqrt(sxx * syy), slope, intercept: my - slope * mx };
}

// Tempoverlauf für die Anzeige: offensichtliche Ausreißer entfernen und – wenn Hürden erkannt sind und ihr Abstand bekannt ist –
// so skalieren, dass die Strecke von Hürde zu Hürde genau dem Abstand entspricht. Das Tempo aus dem Bild allein stimmt nur,
// wenn genau von der Seite gefilmt wird; läuft die Person schräg zur Kamera (Kurve, weit weg), ist es zu niedrig.
export function speedCurve(result, spacingM = 0) {
  const c = result.curves; if (!c || !c.ok) return { v: [], source: 'none' };
  const n = c.v.length, fps = result.fps, v = c.v.slice(), w = Math.max(2, Math.round(0.4 * fps));
  const stride = Math.max(1, Math.floor(w / 12));
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(c.v[i])) continue;
    const a = []; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j += stride) if (Number.isFinite(c.v[j])) a.push(c.v[j]);
    const m = median(a); if ((Number.isFinite(m) && m > 0.5 && (c.v[i] < 0.55 * m || c.v[i] > 1.6 * m)) || c.v[i] > 12.5 || c.v[i] < 0) v[i] = NaN;
  }
  let last = -1; for (let i = 0; i < n; i++) if (Number.isFinite(v[i])) { if (last >= 0 && i - last > 1) for (let j = last + 1; j < i; j++) v[j] = v[last] + (v[i] - v[last]) * (j - last) / (i - last); last = i; }
  const hs = (result.hurdles || []).filter((h) => h.found && Number.isFinite(h.landingIndex)).sort((a, b) => a.landingIndex - b.landingIndex);
  if (!(spacingM > 0) || hs.length < 2) return { v, source: 'video' };
  const fac = new Array(n).fill(NaN), fs = [];
  for (let k = 1; k < hs.length; k++) {
    const a = hs[k - 1].landingIndex, b = hs[k].landingIndex; let I = 0, cnt = 0;
    for (let i = a; i < b; i++) if (Number.isFinite(v[i])) { I += v[i] / fps; cnt++; }
    const T = (b - a) / fps; if (!(T > 0)) continue;
    if (cnt < 0.5 * (b - a) || !(I > 0)) { for (let i = a; i < b; i++) v[i] = spacingM / T; fs.push([a, b, 1]); continue; } // Kurve hier unbrauchbar: Durchschnittstempo
    const f = Math.max(0.4, Math.min(5, spacingM / (I * (b - a) / cnt))); fs.push([a, b, f]);
  }
  if (!fs.length) return { v, source: 'video' };
  for (const [a, b, f] of fs) for (let i = a; i < b; i++) fac[i] = f;
  for (let i = 0; i < fs[0][0]; i++) fac[i] = fs[0][2];
  for (let i = fs[fs.length - 1][1]; i < n; i++) fac[i] = fs[fs.length - 1][2];
  const out = v.map((x, i) => (Number.isFinite(x) && Number.isFinite(fac[i]) ? x * fac[i] : x)), med = median(out);
  // Passt der eingetragene Abstand nicht zu diesen Hürden (z. B. 35 m bei Übungshürden), käme ein unmögliches Tempo heraus: dann nicht eichen
  if (!(med >= 2 && med <= 11)) return { v, source: 'video', badSpacing: true };
  return { v: out, source: 'hurdles', factor: median(fs.map((q) => q[2])) };
}
