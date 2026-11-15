#!/usr/bin/env node
// Prüft Tracking und Auswertung ohne Browser.
//
//   node tests/run-analysis.mjs tests/data/IMG_6246_A.diag.json tests/data/IMG_6246.ref.json --target A [--json out.json]
//
// diag.json = Diagnose-Export der App (v2, Knopf „Diagnose“ bzw. tests/browser/run_app.py).
// ref.json  = Referenz (siehe tests/README.md): Zielperson, Identität je Bild, manuell bestimmte Kontakte.
// Die Auswertung wird mit analysis7.js aus den exportierten Rohpunkten neu gerechnet, damit Änderungen an der
// Auswertung ohne Video vergleichbar sind.
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze, summarize } from '../analysis7.js';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const [diagPath, refPath] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json' && args[i - 1] !== '--target');
if (!diagPath) { console.error('Aufruf: node tests/run-analysis.mjs DIAG.json [REF.json] [--target A] [--json OUT.json]'); process.exit(2); }
const diag = JSON.parse(readFileSync(diagPath, 'utf8'));
const ref = refPath ? JSON.parse(readFileSync(refPath, 'utf8')) : null;
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : ref && ref.target;
const fps = diag.opts.fps, n = diag.frames.length, msPerFrame = 1000 / fps;

const W = diag.W || diag.opts.W, H = diag.H || diag.opts.H;
const out = { diag: diagPath, ref: refPath || null, fps, frames: n };

// ---------- Tracking ----------
const has = diag.frames.map((f) => !!f);
const runs = []; for (let i = 0, s = -1; i <= n; i++) { if (i < n && !has[i]) { if (s < 0) s = i; } else if (s >= 0) { runs.push([s, i - 1]); s = -1; } }
out.tracking = { framesWithPose: has.filter(Boolean).length, lostFrames: has.filter((x) => !x).length, longestGapMs: Math.round(Math.max(0, ...runs.map(([a, b]) => b - a + 1)) * msPerFrame) };
// Identität: Label je Bild (z. B. "A", "B", "?"). Bevorzugt aus von Hand markierten Positionen der Personen (ref.persons),
// sonst aus fertigen Labels (ref.identity.labels).
const ids = (ref && ref.persons) ? labelsFromPersons(ref.persons) : (ref && ref.identity && ref.identity.labels) || null;
if (ids) out.tracking.identityMethod = ref.persons ? 'Positionen von Hand markiert (ref.persons)' : (ref.identity.method || 'Labels');
function labelsFromPersons(persons) {
  const t0 = (diag.i0Frame || 0) / fps;
  // Position einer Person zur Zeit t: linear zwischen zwei Markierungen, nicht über [null]-Lücken hinweg
  const at = (keys, t) => { for (let k = 0; k + 1 < keys.length; k++) { const a = keys[k], b = keys[k + 1]; if (a.length < 3 || b.length < 3) continue; if (t >= a[0] && t <= b[0]) { const u = (t - a[0]) / (b[0] - a[0] || 1); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; } } return null; };
  const ar = H / W; // y in Bildhöhen -> in Bildbreiten umrechnen, damit Abstände in Pixeln vergleichbar sind
  return diag.frames.map((f, i) => {
    if (!f) return null;
    const hip = [(f[23][0] + f[24][0]) / 2, (f[23][1] + f[24][1]) / 2], t = t0 + (i + 0.5) / fps;
    const ds = Object.entries(persons).map(([id, keys]) => { const p = at(keys, t); return p ? [id, Math.hypot(hip[0] - p[0], (hip[1] - p[1]) * ar)] : null; }).filter(Boolean).sort((a, b) => a[1] - b[1]);
    if (!ds.length || ds[0][1] > 0.08) return '?';                // keine markierte Person in der Nähe (Hintergrund, Fehlerkennung)
    if (ds[1] && ds[1][1] < Math.max(1.6 * ds[0][1], ds[0][1] + 0.025)) return '?'; // zwei Personen fast gleich nah: nicht entscheidbar
    return ds[0][0];
  });
}
if (ids && target) {
  let wrong = 0, unknown = 0, switches = 0, last = null; const wrongRuns = [];
  for (let i = 0; i < n; i++) {
    if (!has[i]) continue; const l = ids[i];
    if (l == null || l === '?') { unknown++; continue; }
    if (l !== target) { wrong++; if (!wrongRuns.length || wrongRuns[wrongRuns.length - 1][1] !== i - 1) wrongRuns.push([i, i]); else wrongRuns[wrongRuns.length - 1][1] = i; }
    if (last && l !== last) switches++; last = l;
  }
  Object.assign(out.tracking, { target, identitySwitches: switches, wrongPersonFrames: wrong, unknownFrames: unknown, wrongPersonRuns: wrongRuns.map(([a, b]) => `${(a / fps).toFixed(2)}–${(b / fps).toFixed(2)} s`) });
}

// ---------- Pose-Stabilität (Rohpunkte der Zielperson) ----------
const JOINTS = { Schulter: [11, 12], Hüfte: [23, 24], Knie: [25, 26], Knöchel: [27, 28], Ferse: [29, 30], Fußspitze: [31, 32] };
// Maßstab: Beinlänge im Bild (90-%-Quantil), Körpergröße aus den Optionen -> Pixel je cm
const legs = []; for (const f of diag.frames) if (f) for (const [h, k, a] of [[23, 25, 27], [24, 26, 28]]) { const P = (j) => [f[j][0] * W, f[j][1] * H]; if (f[h][2] > 0.3 && f[k][2] > 0.3 && f[a][2] > 0.3) legs.push(Math.hypot(...P(h).map((v, q) => v - P(k)[q])) + Math.hypot(...P(k).map((v, q) => v - P(a)[q]))); }
legs.sort((a, b) => a - b); const legPx = legs[Math.floor(0.9 * (legs.length - 1))] || NaN;
const pxPerCm = legPx / (0.49 * (diag.opts.heightCm || 180));
out.pose = {};
for (const [name, ks] of Object.entries(JOINTS)) {
  let jumps = 0, pairs = 0, missing = 0, total = 0;
  for (const k of ks) for (let i = 0; i < n; i++) {
    const f = diag.frames[i]; if (!f) continue; total++;
    if (f[k][2] <= 0.2) { missing++; continue; }
    const g = diag.frames[i - 1]; if (!g || g[k][2] <= 0.2) continue; pairs++;
    // Sprung = mehr als 5 cm je 1/60 s über die Bewegung der Hüfte hinaus (Hüfte wandert mit Kamera und Läufer)
    const hip = (q) => [(q[23][0] + q[24][0]) / 2 * W, (q[23][1] + q[24][1]) / 2 * H];
    const d = Math.hypot((f[k][0] - g[k][0]) * W - (hip(f)[0] - hip(g)[0]), (f[k][1] - g[k][1]) * H - (hip(f)[1] - hip(g)[1]));
    if (d / pxPerCm > 5 * 60 / fps * (k >= 25 ? 3 : 1)) jumps++; // Beine dürfen sich im Sprint ~3× so schnell relativ zur Hüfte bewegen
  }
  out.pose[name] = { jumpPct: pairs ? +(100 * jumps / pairs).toFixed(1) : null, missingPct: total ? +(100 * missing / total).toFixed(1) : null };
}

// ---------- Auswertung neu rechnen ----------
const frames = diag.frames.map((lm) => ({ lm }));
const r = analyze(frames, { ...diag.opts });
const sum = summarize(r);
out.analysis = { contacts: r.contacts.length, includedSteps: r.steps.filter((s) => s.include).length, contactMs: round(sum.contactMs), flightMs: round(sum.flightMs), cadenceHz: round(sum.cadenceHz, 2), sameAsApp: r.contacts.length === diag.contacts.length && r.contacts.every((c, k) => c.i0 === diag.contacts[k].i0 && c.i1 === diag.contacts[k].i1 && c.side === diag.contacts[k].side) };
if (!out.analysis.sameAsApp) out.analysis.note = 'Neu gerechnete Kontakte weichen von der App ab (alter Export mit gerundeten Punkten oder geänderte Auswertung).';

// ---------- Kontakte gegen manuelle Referenz ----------
if (ref && Array.isArray(ref.contacts) && ref.contacts.length) {
  const auto = r.contacts.map((c) => ({ side: c.side, td: c.td / fps, to: c.to / fps }));
  const pairs = [], missed = [];
  for (const m of ref.contacts) {
    const best = auto.map((a, j) => ({ a, j, d: Math.abs(a.td - m.td) })).filter((x) => x.d < 0.08).sort((x, y) => x.d - y.d)[0];
    if (!best) { missed.push(m); continue; }
    pairs.push({ ref: m, auto: best.a, dTdMs: (best.a.td - m.td) * 1000, dToMs: (best.a.to - m.to) * 1000, dContactMs: ((best.a.to - best.a.td) - (m.to - m.td)) * 1000, sideOk: best.a.side === m.side });
  }
  const st = (k) => { const v = pairs.map((p) => p[k]); return v.length ? { mean: round(v.reduce((s, x) => s + x, 0) / v.length, 1), meanAbs: round(v.reduce((s, x) => s + Math.abs(x), 0) / v.length, 1), maxAbs: round(Math.max(...v.map(Math.abs)), 1) } : null; };
  out.contacts = { reference: ref.contacts.length, matched: pairs.length, missed: missed.length, extra: auto.length - pairs.length, wrongSide: pairs.filter((p) => !p.sideOk).length, touchdownMs: st('dTdMs'), toeOffMs: st('dToMs'), contactTimeMs: st('dContactMs') };
}

function round(v, d = 0) { return Number.isFinite(v) ? +v.toFixed(d) : null; }
console.log(JSON.stringify(out, null, 2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
