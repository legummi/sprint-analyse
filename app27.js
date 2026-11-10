import { speedCurve, analyze, summarize, summarizeLR, transitionStep, hints, correlate, METRICS, HURDLE_METRICS, median, PHASES, REF, CATEGORIES, suggestPhase, evaluate, extractStride, rotatePt } from './analysis7.js';
import { FigurePlayer } from './figure2.js';

// ======================= Helfer =======================
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseNum = (s) => { const v = parseFloat(String(s ?? '').replace(',', '.').trim()); return Number.isFinite(v) ? v : null; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IC = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a1 1 0 0 0 1.52.85l11-6.8a1 1 0 0 0 0-1.7l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.4" height="14" rx="1.4" fill="currentColor"/><rect x="13.6" y="5" width="4.4" height="14" rx="1.4" fill="currentColor"/></svg>',
};
const setPlay = (b, on) => { if (!b) return; b.innerHTML = on ? IC.pause : IC.play; b.setAttribute('aria-label', on ? 'Pause' : 'Abspielen'); };
const M = (k) => METRICS.find((m) => m.key === k) || HURDLE_METRICS.find((m) => 'h_' + m.key === k) || { key: k, label: k, unit: '', digits: 0 };
const shortLabel = (k) => M(k).label.split(' (')[0];
const phaseName = (id) => (PHASES.find((p) => p.id === id) || {}).short || '';
const dateDE = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('de-DE') : '');
const round = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
function cleanObj(o, d = 2) { const out = {}; for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'number' ? round(v, d) : v; return out; }

// kleines haptisches Feedback (Android), visuell über :active
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.btn, .chip, .seg button, .tabbar button, .ringtile, .li, .run, .mrow, .fs-tool, .tbtn, .fs-next')) { try { navigator.vibrate && navigator.vibrate(6); } catch {} } }, { passive: true });

let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

// Sheet (von unten) – ersetzt Dialoge
let sheetClose = null;
function openSheet(html, onMount) {
  $('sheetBody').innerHTML = html; $('scrim').classList.add('on'); $('sheet').classList.add('on'); $('sheet').scrollTop = 0;
  if (onMount) onMount($('sheetBody'));
  return new Promise((res) => { sheetClose = res; });
}
function closeSheet(v) { $('scrim').classList.remove('on'); $('sheet').classList.remove('on'); if (sheetClose) { const f = sheetClose; sheetClose = null; f(v); } if (cmpPlayer) cmpPlayer.pause(); }
$('scrim').onclick = () => closeSheet(false);
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if ($('sheet').classList.contains('on')) closeSheet(false); else if (document.querySelector('.vfs')) clearFocus(); });
function confirmSheet(title, text, yes = 'OK', danger = false) {
  return openSheet(`<h2>${esc(title)}</h2><p class="hint">${esc(text)}</p><div class="foot"><button class="btn" data-no>Abbrechen</button><button class="btn ${danger ? '' : 'primary'}" style="${danger ? 'color:var(--off)' : ''}" data-yes>${esc(yes)}</button></div>`,
    (el) => { el.querySelector('[data-no]').onclick = () => closeSheet(false); el.querySelector('[data-yes]').onclick = () => closeSheet(true); });
}

// Segmented Controls mit gleitender Markierung
function initSeg(el, onChange) {
  const btns = [...el.querySelectorAll('button')];
  el.style.setProperty('--n', btns.length);
  const sync = () => { const i = Math.max(0, btns.findIndex((b) => b.classList.contains('on'))); el.style.setProperty('--i', i); };
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); btns.forEach((x) => x.classList.toggle('on', x === b)); sync(); onChange && onChange(b.dataset.v); });
  sync();
  return { set(v) { btns.forEach((x) => x.classList.toggle('on', x.dataset.v === v)); sync(); }, get() { const b = btns.find((x) => x.classList.contains('on')); return b && b.dataset.v; } };
}

// ======================= Navigation =======================
const VIEWS = ['analyse', 'laeufe', 'auswertung', 'hilfe'];
let curScreen = 's-pick';
function showView(v) {
  clearFocus();
  if (v !== 'laeufe' && selecting) { selecting = false; picked = []; $('selectBtn').textContent = 'Vergleichen'; }
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  if (v === 'laeufe') renderRuns();
  if (v === 'auswertung') renderAnalysis();
  if (v === 'analyse') updateTop(); else { $('backBtn').classList.remove('on'); $('topTitle').textContent = { laeufe: 'Läufe', auswertung: 'Auswertung', hilfe: 'Hilfe' }[v]; }
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  window.scrollTo({ top: 0 });
}
$('tabbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showView(b.dataset.view); });
document.addEventListener('click', (e) => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); showView(a.dataset.goto); } });
function showScreen(id) {
  curScreen = id; cancelAuto(); clearFocus();
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  // Video-Element dort parken, wo es sichtbar gebraucht wird
  if (id !== 's-setup') setFs(false);
  if (id === 's-setup') { $('setupStage').prepend(video); if (preferFs() && video.src) setFs(true); } else vidHolder.appendChild(video);
  updateTop(); window.scrollTo({ top: 0 });
}
function updateTop() {
  const map = { 's-pick': ['Sprint-Analyse', null], 's-setup': ['Einrichten', 'Abbrechen'], 's-progress': ['Analyse läuft', null], 's-result': ['Ergebnis', 'Neu'], 's-batch': ['Mehrere Videos', 'Abbrechen'] };
  const [t, back] = map[curScreen] || ['Sprint-Analyse', null];
  $('topTitle').textContent = t; $('backTxt').textContent = back || ''; $('backBtn').classList.toggle('on', !!back);
}
$('backBtn').onclick = async () => {
  if (curScreen === 's-result' && state.result && (!state.savedId || state.dirty)) { if (!(await confirmSheet('Ergebnis verwerfen?', 'Der Lauf ist noch nicht gespeichert.', 'Verwerfen', true))) return; }
  if (curScreen === 's-batch' && batch.running) { state.cancel = true; return; }
  video.pause(); showScreen('s-pick');
};
const vidHolder = document.createElement('div');
vidHolder.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:240px;overflow:hidden';
document.body.appendChild(vidHolder);

// ======================= Speicher =======================
const LOCAL_KEY = 'sprintanalyse.runs.v1', LOCAL_PROFILE = 'sprintanalyse.profile.v1';
const store = { mode: 'connecting', db: null, uid: null, runs: [], profile: {}, unsub: null, reason: '' };
const localRead = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } };
const localWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
function setStoreInfo() {
  const el = $('storeInfo');
  el.className = 'store ' + (store.mode === 'cloud' ? 'cloud' : store.mode === 'local' ? 'local' : '');
  el.lastElementChild.textContent = store.mode === 'cloud' ? 'Claude-Konto' : store.mode === 'local' ? 'nur dieser Browser' : 'verbinde …';
  $('storageHelp').innerHTML = store.mode === 'cloud'
    ? 'Deine Läufe liegen privat in deinem Claude-Konto – nur du siehst sie, auch nicht der Ersteller der Seite. Videos werden nie hochgeladen.'
    : 'Deine Läufe werden <b>nur in diesem Browser</b> gespeichert' + (store.reason ? ' (' + esc(store.reason) + ')' : '') + '. Sichere sie unter „Läufe“ regelmäßig als Datei. Für Speicherung im Claude-Konto muss dich der Ersteller der Seite als Bearbeiter einladen.';
  $('migrateBtn').hidden = !(store.mode === 'cloud' && localRead(LOCAL_KEY, []).length);
  $('runsCount').textContent = store.runs.length ? `${store.runs.length} gespeicherte Läufe ansehen und vergleichen` : 'Gespeicherte Analysen ansehen und vergleichen';
}
function useLocal(reason) {
  if (store.unsub) { try { store.unsub(); } catch {} store.unsub = null; }
  Object.assign(store, { mode: 'local', reason: reason || '', runs: localRead(LOCAL_KEY, []), profile: localRead(LOCAL_PROFILE, {}) });
  setStoreInfo(); onRunsChanged(); applyProfile();
}
const runsCol = () => store.db.doc('data/users/' + store.uid + '/profile').collection('runs');
const profileDoc = () => store.db.doc('data/users/' + store.uid + '/profile');
async function initStore() {
  let db = null, user = null;
  try { if (window.claude && typeof window.claude.use === 'function') [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch {}
  if (!db || !user) return useLocal('nicht bei Claude angemeldet oder Speicher nicht verfügbar');
  let id = null; try { id = await user.id(); } catch {}
  if (!id) return useLocal('kein Claude-Konto erkannt');
  let canWrite = null; try { canWrite = await user.can('data.write'); } catch {}
  if (canWrite === false) return useLocal('du hast für diese Seite nur Leserechte');
  Object.assign(store, { db, uid: id, mode: 'cloud' }); setStoreInfo();
  try { const p = await profileDoc().get(); store.profile = p.exists ? { ...p.data() } : {}; applyProfile(); } catch {}
  let got = false; const timer = setTimeout(() => { if (!got) $('storeInfo').lastElementChild.textContent = 'Verbindung langsam'; }, 10000);
  store.unsub = runsCol().orderBy('date', 'desc').onSnapshot((snap) => {
    store.runs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    if (!snap.metadata.fromCache) { got = true; clearTimeout(timer); setStoreInfo(); }
    onRunsChanged();
  }, (err) => { clearTimeout(timer); useLocal('Cloud nicht erreichbar (' + (err && err.code) + ')'); });
}
const sortRuns = () => store.runs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
async function saveRun(run) {
  if (store.mode === 'cloud') {
    try { await runsCol().doc(run.id).set(run); return; }
    catch (e) {
      if (e && ['invalid_argument', 'not_granted', 'revoked'].includes(e.code)) { useLocal('Speichern im Claude-Konto nicht erlaubt'); return saveRun(run); }
      if (e && e.code === 'unavailable') { await sleep(800 + Math.random() * 800); await runsCol().doc(run.id).set(run); return; }
      throw e;
    }
  }
  store.runs = store.runs.filter((r) => r.id !== run.id); store.runs.push(run); sortRuns();
  if (!localWrite(LOCAL_KEY, store.runs)) throw new Error('Browser-Speicher voll oder gesperrt – bitte als Datei sichern.');
  onRunsChanged();
}
async function updateRun(id, patch) {
  if (store.mode === 'cloud') return runsCol().doc(id).update(patch);
  const r = store.runs.find((x) => x.id === id); if (!r) return; Object.assign(r, patch); sortRuns(); localWrite(LOCAL_KEY, store.runs); onRunsChanged();
}
async function deleteRun(id) {
  if (store.mode === 'cloud') return runsCol().doc(id).delete();
  store.runs = store.runs.filter((r) => r.id !== id); localWrite(LOCAL_KEY, store.runs); onRunsChanged();
}
async function saveProfile(patch) {
  if (Object.keys(patch).every((k) => store.profile[k] === patch[k])) return;
  Object.assign(store.profile, patch);
  if (store.mode === 'cloud') { try { await profileDoc().set({ ...store.profile }); } catch {} } else localWrite(LOCAL_PROFILE, store.profile);
}
function applyProfile() { if (store.profile.heightCm && !state.heightTouched) { $('height').value = store.profile.heightCm; $('bHeight').value = store.profile.heightCm; } }
function onRunsChanged() {
  const labels = [...new Set(['20 m fliegend', '30 m fliegend', '40 m fliegend', '60 m', '100 m', '400 m', '1.–3. Hürde', ...store.runs.map((r) => r.label).filter(Boolean)])];
  $('labelList').innerHTML = labels.map((l) => `<option value="${esc(l)}">`).join('');
  setStoreInfo(); renderRecent();
  if ($('v-laeufe').classList.contains('on')) renderRuns();
  if ($('v-auswertung').classList.contains('on')) renderAnalysis();
}

// ======================= Einrichten =======================
const state = {
  file: null, url: null, fileFps: 30, duration: 0, start: 0, end: 0, W: 0, H: 0,
  mode: 'sprint', camera: 'pan', phase: 'auto', heightTouched: false,
  tap: null, lane: [], calib: [], personPt: null, personT: null, personPose: null, hurdles: [], hSel: 'all', markT: null, step: 1,
  frames: null, frameTimes: null, i0Frame: 0, result: null, analysisOpts: null, resPhase: 'maxv', phaseAuto: true, savedId: null, cancel: false,
};
const video = $('video');
let fsOn = false, fsHome = null;
document.addEventListener('touchstart', () => {}, { passive: true });
const segMode = initSeg($('segMode'), (v) => { state.mode = v; $('hurdleBox').hidden = v !== 'hurdle'; if (v !== 'hurdle' && state.tap === 'hurdle') setTap(null); updateTapInfo(); drawSetupOverlay(); fsRender(); });
const segPhase = initSeg($('segPhase'), (v) => { state.phase = v; });
const segCam = initSeg($('segCam'), (v) => { state.camera = v; syncCalibSect(); fsRender(); });
function syncCalibSect() { const el = $('calibSect'); if (el) el.hidden = state.camera !== 'fixed'; if (state.camera !== 'fixed' && state.tap === 'calib') setTap(null); }
$('height').addEventListener('input', () => { state.heightTouched = true; });

const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => pickFiles(e.dataTransfer.files));
$('file').addEventListener('change', (e) => { pickFiles(e.target.files); e.target.value = ''; });
$('fileMulti').addEventListener('change', (e) => { pickFiles(e.target.files); e.target.value = ''; });
$('goCompare').onclick = () => { if (store.runs.length < 2) return toast('Zum Vergleichen brauchst du zwei gespeicherte Läufe'); showView('laeufe'); selecting = true; picked = []; $('selectBtn').textContent = 'Fertig'; renderRuns(); };
function renderRecent() {
  const el = $('recentRuns'); if (!el) return;
  const runs = store.runs.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 3);
  el.innerHTML = runs.length ? runs.map((r) => `<button class="rrow" data-rid="${esc(r.id)}">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '<span class="ph"></span>'}<span style="min-width:0"><span class="t">${esc(r.label || 'Ohne Bezeichnung')}</span><br><span class="m">${esc(dateDE(r.date))}${r.mode === 'hurdle' ? ' · Hürde' : ' · Sprint'}</span></span><span class="tm">${r.timeS != null ? fmt(r.timeS, 2) + ' s' : ''}</span></button>`).join('')
    : '<ol class="howto"><li><b>Video wählen</b><span>Seitlich gefilmt, am besten in Zeitlupe.</span></li><li><b>Ausschnitt prüfen</b><span>Die App sucht dich im Video. Du passt nur noch an.</span></li><li><b>Ergebnis lesen</b><span>Zeiten, Winkel und Tipps. Jeden Wert kannst du im Video nachprüfen.</span></li></ol>';
  const sr = el.previousElementSibling; if (sr && sr.classList.contains('sect-row')) { sr.querySelector('.sect2').textContent = runs.length ? 'Letzte Läufe' : 'So geht\u2019s'; sr.querySelector('.linkbtn').hidden = !runs.length; }
}
$('recentRuns').addEventListener('click', (e) => { const b = e.target.closest('[data-rid]'); if (!b) return; const r = store.runs.find((x) => x.id === b.dataset.rid); if (r) openRun(r); });
function pickFiles(list) {
  const files = [...list].filter((f) => (f.type || '').startsWith('video/') || /\.(mov|mp4|m4v|webm|avi)$/i.test(f.name));
  if (!files.length) return toast('Keine Videodatei erkannt');
  if (files.length === 1) loadFile(files[0]); else startBatch(files);
}

async function openVideo(f) {
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = f; state.url = URL.createObjectURL(f); video.src = state.url + '#t=0.001';
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('format')); });
  Object.assign(state, { duration: video.duration, W: video.videoWidth, H: video.videoHeight });
  state.fileFps = await detectFps();
}
async function loadFile(f) {
  Object.assign(state, { lane: [], calib: [], personPt: null, personT: null, personPose: null, hurdles: [], hSel: 'all', markT: null, result: null, frames: null, savedId: null, step: 1, tap: null, autoDone: false, multi: false, dirty: false, addRunner: false, runners: [], runnerIdx: 0 }); cancelAuto(); $('calibInfo').textContent = ''; $('calibM').value = '';
  showScreen('s-setup'); setStep(1);
  $('setupMsg').innerHTML = ''; $('fpsInfo').textContent = 'Bildrate wird ermittelt …';
  try { await openVideo(f); }
  catch { $('setupMsg').innerHTML = '<div class="notice err">Dieses Videoformat kann der Browser nicht öffnen. Auf dem iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“, oder als MP4 exportieren.</div>'; return; }
  state.start = 0; state.end = state.duration; $('hurdleNr').value = '1'; renderHurdleChips();
  fillFps(); updateRange(); syncCalibSect(); if (preferFs()) setFs(true); sizeOverlay(); seekTo(Math.min(0.05, state.duration / 2)).then(() => { drawSetupOverlay(); paintPlayhead(); setTimeout(maybeAuto, 250); });
}
async function detectFps() {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return 30;
  const times = []; const t0 = video.currentTime;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true; video.pause(); video.playbackRate = 1; try { video.currentTime = t0; } catch {}
      const d = []; for (let i = 1; i < times.length; i++) { const x = times[i] - times[i - 1]; if (x > 0.001) d.push(x); }
      if (d.length < 3) return resolve(30);
      const minD = Math.min(...d.filter((x) => x > Math.min(...d) * 0.5));
      const raw = 1 / median(d.filter((x) => x < minD * 1.5));
      const common = [24, 25, 30, 48, 50, 60, 90, 100, 120, 180, 240, 960];
      const best = common.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
      resolve(Math.abs(best - raw) / raw < 0.08 ? best : Math.round(raw));
    };
    const cb = (now, meta) => { times.push(meta.mediaTime); if (times.length >= 14) finish(); else video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb); video.muted = true; video.playbackRate = 0.2; video.play().catch(() => finish()); setTimeout(finish, 2500);
  });
}
function fillFps() {
  const f = state.fileFps, opts = [...new Set([f, 30, 60, 120, 240])].sort((a, b) => a - b);
  $('fps').innerHTML = opts.map((o) => `<option value="${o}" ${o === f ? 'selected' : ''}>${o} fps${o === f ? ' (wie Datei)' : ''}</option>`).join('');
  $('fpsInfo').textContent = `Die Datei hat ${f} Bilder pro Sekunde. Wenn du in Zeitlupe gefilmt hast und das Video langsam abläuft, wähle die Aufnahme-fps (z. B. 240).`;
}
let lastSeekT = null;
function seekTo(t) {
  lastSeekT = t;
  return new Promise((res) => {
    let done = false; const fin = () => { if (!done) { done = true; video.removeEventListener('seeked', fin); res(); } };
    scrubPending = null; video.addEventListener('seeked', fin); setTimeout(fin, 3000); video.currentTime = Math.max(0, Math.min(state.duration - 0.001, t));
  });
}
// Transport
const frameDur = () => 1 / (state.fileFps || 30);
$('vPlay').onclick = () => { cancelAuto(); if (video.paused) { try { video.playbackRate = Math.min(16, 0.5 * Math.max(1, (parseNum($('fps').value) || state.fileFps || 30) / (state.fileFps || 30))); } catch { video.playbackRate = 1; } if (video.currentTime >= state.duration - 0.05) video.currentTime = Math.max(0, state.start); const p = video.play(); if (p && p.catch) p.catch(() => {}); } else video.pause(); };
video.addEventListener('pause', () => setPlay($('vPlay'), false));
video.addEventListener('play', () => { if (curScreen === 's-setup') setPlay($('vPlay'), true); });
$('vPrev').onclick = () => { cancelAuto(); video.pause(); seekTo(video.currentTime - frameDur()); };
$('vNext').onclick = () => { cancelAuto(); video.pause(); seekTo(video.currentTime + frameDur()); };
function paintPlayhead(tAt) {
  if (!state.duration) return; const t = Number.isFinite(tAt) ? tAt : video.currentTime;
  $('rangeCur').style.left = (Math.max(0, Math.min(1, t / state.duration)) * 100) + '%'; $('vTime').textContent = fmt(t, 2) + ' s';
}
// Spulen ohne Stau: solange das Video noch sucht, wird nur das letzte Ziel gemerkt
let scrubPending = null, scrubSince = 0;
function scrubTo(t) {
  t = Math.max(0, Math.min(state.duration - 0.001, t)); lastSeekT = t; paintPlayhead(t);
  const now = performance.now();
  if (video.seeking && now - scrubSince < 500) { scrubPending = t; return; }
  scrubPending = null; scrubSince = now; video.currentTime = t;
}
function scrubFlush() { if (scrubPending == null) return; const t = scrubPending; scrubPending = null; if (Math.abs(t - video.currentTime) > frameDur() * 0.4) { scrubSince = performance.now(); video.currentTime = t; } }
video.addEventListener('timeupdate', () => paintPlayhead());
video.addEventListener('seeked', () => { scrubFlush(); if (curScreen === 's-setup') { if (fsOn && state.step === 2) fsRender(); if (scrubPending == null) paintPlayhead(); drawSetupOverlay(); } });
// Zeitleiste: ziehen spult, die gelben Griffe setzen Anfang und Ende
{ const bar = $('rangeBar'); let td = null;
  const at = (e) => { const r = bar.getBoundingClientRect(); return { x: e.clientX - r.left, w: r.width || 1 }; };
  const move = (e) => {
    if (!td) return; const p = at(e), t = Math.max(0, Math.min(1, p.x / p.w)) * state.duration, minLen = Math.max(0.05, 10 / (state.fileFps || 30));
    if (td === 'start') { state.start = Math.max(0, Math.min(t, state.end - minLen)); scrubTo(state.start); paintRange(); showHud(`Start ${fmt(state.start, 2)} s · ${rangeFrames()} Bilder`); }
    else if (td === 'end') { state.end = Math.min(state.duration, Math.max(t, state.start + minLen)); scrubTo(state.end); paintRange(); showHud(`Ende ${fmt(state.end, 2)} s · ${rangeFrames()} Bilder`); }
    else scrubTo(t);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!state.duration) return; cancelAuto(); video.pause(); e.preventDefault();
    const p = at(e), xs = state.start / state.duration * p.w, xe = state.end / state.duration * p.w;
    td = 'scrub';
    if (state.step === 1) { const ds = Math.abs(p.x - (xs + 7)), de = Math.abs(p.x - (xe - 7)); if (Math.min(ds, de) < 24) td = ds < de || (ds === de && p.x < xs) ? 'start' : 'end'; }
    try { bar.setPointerCapture(e.pointerId); } catch {}
    move(e);
  });
  bar.addEventListener('pointermove', move);
  const up = () => { if (!td) return; const was = td; td = null; hideHud(); if (was !== 'scrub') updateRange(); };
  bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
}
function showHud(txt, busy) { const h = $('stageHud'); h.textContent = txt; h.classList.toggle('busy', !!busy); h.hidden = false; }
function hideHud() { $('stageHud').hidden = true; }
function flashBtn(b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
$('setStart').onclick = () => { cancelAuto(); video.pause(); state.start = Math.min(video.currentTime, state.end - 0.05); updateRange(); flashBtn($('setStart')); toast(`Start bei ${fmt(state.start, 2)} s gesetzt`); };
$('setEnd').onclick = () => { cancelAuto(); video.pause(); state.end = Math.max(video.currentTime, state.start + 0.05); updateRange(); flashBtn($('setEnd')); toast(`Ende bei ${fmt(state.end, 2)} s gesetzt`); };
const rangeFrames = () => Math.round((state.end - state.start) * (state.fileFps || 30));
function paintRange() {
  if (!state.duration) return;
  const n = rangeFrames();
  const sSet = state.start > 0.001, eSet = state.end < state.duration - 0.001;
  $('setStart').textContent = sSet ? `Start ✓ ${fmt(state.start, 2)} s` : 'Start hier'; $('setStart').classList.toggle('set', sSet);
  $('setEnd').textContent = eSet ? `Ende ✓ ${fmt(state.end, 2)} s` : 'Ende hier'; $('setEnd').classList.toggle('set', eSet);
  $('rangeSel').style.left = (state.start / state.duration * 100) + '%'; $('rangeSel').style.width = ((state.end - state.start) / state.duration * 100) + '%';
  $('rangeBar').classList.toggle('locked', state.step !== 1);
  $('rangeInfo').innerHTML = `Ausschnitt ${fmt(state.start, 2)}–${fmt(state.end, 2)} s, <span class="num">${n}</span> Bilder.` + (n > 6000 ? ' <span class="t-off">Bitte kürzen – höchstens 6000.</span>' : ' Kürze auf die Schritte, in denen du durchs Bild läufst.');
}
function updateRange() { paintRange(); fsRender(); }
function rangeOk() {
  const n = rangeFrames();
  if (n > 6000) { toast(`Ausschnitt zu lang: ${n} Bilder. Gelbe Griffe zusammenziehen, höchstens 6000.`); return false; }
  if (n < 10) { toast('Der Ausschnitt ist zu kurz.'); return false; }
  return true;
}

// Sucht dich im Video und schlägt den Ausschnitt vor (läuft nach dem Laden von selbst, jede Berührung bricht ab)
let autoTok = 0, autoBusy = false;
function cancelAuto() { if (!autoBusy) return; autoTok++; autoBusy = false; hideHud(); fsRender(); }
function maybeAuto() { if (state.autoDone || curScreen !== 's-setup' || state.step !== 1 || !state.duration || video.readyState < 2 || drag) return; state.autoDone = true; autoFindRunner(false); }
async function autoFindRunner(manual) {
  if (!state.duration || autoBusy) return;
  const tok = ++autoTok; autoBusy = true; state.autoDone = true; video.pause();
  const busy = (t) => { if (tok === autoTok && autoBusy) showHud(t, true); };
  busy('Suche dich im Video …'); fsRender();
  const N = Math.max(8, Math.min(24, Math.round(state.duration / 0.3))), hits = [];
  try {
    const lmk = await getLandmarker(() => {});
    for (let k = 0; k < N; k++) {
      if (tok !== autoTok) return;
      const t = (k + 0.5) / N * state.duration; await seekTo(t);
      if (tok !== autoTok) return;
      let ok = false, cnt = 0;
      try { state.tsBase = (state.tsBase || 0) + 1; const r = lmk.detectForVideo(video, state.tsBase), poses = (r && r.landmarks) || []; cnt = poses.length; ok = poses.some((p) => bbox(p).h > 0.12); } catch {}
      hits.push({ t, ok, cnt }); busy(`Suche dich im Video … ${Math.round((k + 1) / N * 100)} %`);
    }
  } catch { /* Modell nicht ladbar: dann wählt man den Ausschnitt eben selbst */ }
  if (tok !== autoTok) return;
  autoBusy = false; hideHud();
  // längste zusammenhängende Strecke mit Person (eine Lücke erlaubt)
  let best = null, cur = null, gap = 0;
  hits.forEach((h, i) => { if (h.ok) { if (!cur) cur = { a: i, b: i }; cur.b = i; gap = 0; if (!best || cur.b - cur.a > best.b - best.a) best = { ...cur }; } else if (cur && ++gap > 1) cur = null; });
  if (!best) { if (manual) toast('Niemand erkannt. Wähle den Ausschnitt mit den gelben Griffen.'); await seekTo(Math.min(0.05, state.duration / 2)); fsRender(); return; }
  const stepT = state.duration / N, fps = state.fileFps || 30, maxLen = 5980 / fps;
  let a = Math.max(0, hits[best.a].t - stepT * 0.8), b = Math.min(state.duration, hits[best.b].t + stepT * 0.8), cut = false;
  if (b - a > maxLen) { const mid = (a + b) / 2; a = Math.max(0, Math.min(state.duration - maxLen, mid - maxLen / 2)); b = a + maxLen; cut = true; }
  if (b - a < 12 / fps) b = Math.min(state.duration, a + 12 / fps);
  const full = a < 0.02 && b > state.duration - 0.02;
  state.start = a; state.end = b; state.multi = hits.some((h) => h.cnt > 1);
  updateRange(); await seekTo((a + b) / 2); if (tok !== autoTok) return;
  toast(cut ? 'Ausschnitt gewählt und auf 6000 Bilder gekürzt' : full ? 'Du bist im ganzen Video zu sehen' : 'Ausschnitt automatisch gewählt – Griffe ziehen passt ihn an');
}
$('autoFind').onclick = () => autoFindRunner(true);
$('stageHud').addEventListener('click', () => cancelAuto());

// Wizard-Schritte
const STEP_TXT = {
  1: ['Ausschnitt', 'Wähle den Teil des Videos, in dem du durchs Bild läufst.'],
  2: ['Bahnlinie', 'Zwei Punkte auf einer Bahnlinie legen fest, was waagrecht ist.'],
  3: ['Details', 'Damit die Werte richtig eingeordnet werden.'],
};
function setStep(n) {
  if (n === 2) n = state.step === 3 ? 1 : 3; // Schritt Bahnlinie entfällt
  cancelAuto(); state.step = n; document.body.classList.remove('fs-clean'); $('rangeBar').classList.toggle('locked', n !== 1);
  $('st2').hidden = true; [1, 2, 3].forEach((k) => { $('st' + k).classList.toggle('on', k <= n); document.querySelector(`[data-step="${k}"]`).hidden = k !== n; });
  $('setupTitle').textContent = STEP_TXT[n][0]; $('setupSub').textContent = STEP_TXT[n][1];
  $('setupBack').textContent = n === 1 ? 'Abbrechen' : 'Zurück';
  $('setupNext').textContent = n === 3 ? 'Analysieren' : n === 2 && state.lane.length < 2 ? 'Überspringen' : 'Weiter';
  $('rangeBtns').hidden = n !== 1;
  setTap(n === 2 && state.lane.length < 2 ? 'lane' : n === 3 && state.mode === 'hurdle' ? 'hurdle' : null);
  if (n === 2 && state.markT == null && (video.currentTime < state.start || video.currentTime > state.end)) seekTo(state.start);
  $('tapLayer').classList.toggle('on', n > 1 || !!state.tap);
  updateMarkJump(); drawSetupOverlay(); fsRender();
  if (n === 3) checkPeople();
}
// Mehrere Personen im Bild? Dann gezielt bitten, sich anzutippen – sonst kann die Erkennung zur falschen Person springen.
async function checkPeople() {
  if (state.personPt) return;
  try {
    const lmk = await getLandmarker(() => {}); state.tsBase = (state.tsBase || 0) + 1;
    const r = lmk.detectForVideo(video, state.tsBase); const k = ((r && r.landmarks) || []).length;
    if (k >= 2 && !state.personPt && state.step === 3) {
      state.multi = true; $('tapInfo').innerHTML = '<b style="color:var(--track)">Mehrere Personen im Bild.</b> Tippe auf dich, sonst kann die Erkennung zu jemand anderem springen.';
      setTap('person');
    }
  } catch {}
}
$('setupBack').onclick = () => { if (state.step === 1) { video.pause(); showScreen('s-pick'); } else setStep(state.step - 1); };
const goNext = () => { cancelAuto(); if (state.step === 3 && state.addRunner && !state.personPt) return toast('Tippe zuerst den nächsten Läufer an'); if (state.step === 1 && !rangeOk()) return; if (state.step < 3) setStep(state.step + 1); else runAnalysis(); };
$('setupNext').onclick = goNext;

// Antippen: Bahnlinie, Person, Hürde
function setTap(mode) {
  state.tap = mode; document.body.classList.toggle('fs-armed', !!mode); if (mode) document.body.classList.remove('fs-clean'); $('tapLayer').classList.toggle('on', state.step > 1 || !!mode); $('tapLayer').classList.toggle('place', !!mode);
  $('tapPerson').classList.toggle('armed', mode === 'person'); $('tapHurdle').classList.toggle('armed', mode === 'hurdle');
  $('calibBtn').classList.toggle('armed', mode === 'calib'); $('laneReset').classList.toggle('armed', mode === 'lane');
  $('calibBtn').textContent = mode === 'calib' ? (state.calib.length ? 'Jetzt Markierung B setzen …' : 'Jetzt Markierung A setzen …') : state.calib.length === 2 ? 'Markierungen ✓ – neu setzen' : 'Zwei Markierungen setzen';
  $('tapPerson').textContent = mode === 'person' ? 'Tippe auf dich …' : state.personPt ? 'Ich ✓ – neu antippen' : 'Mich antippen';
  { const nr = hurdleNr(), has = state.hurdles.some((h) => h.nr === nr); $('tapHurdle').textContent = mode === 'hurdle' ? `Tippe auf Hürde ${nr} …` : has ? `Hürde ${nr} ✓ – neu setzen` : `Hürde ${nr} markieren`; }
  const b = $('setupBadge'); b.hidden = !mode;
  b.textContent = mode === 'calib' ? (state.calib.length ? 'Zweite Markierung antippen' : 'Erste Markierung antippen') : mode === 'lane' ? (state.lane.length ? 'Zweiten Punkt auf der Bahnlinie antippen' : 'Ersten Punkt auf einer Bahnlinie antippen') : mode === 'person' ? 'Tippe auf dich' : mode === 'hurdle' ? `Tippe auf die Oberkante von Hürde ${hurdleNr()}` : '';
  if (mode) video.pause();
  fsRender();
}
// Punkte setzen und verschieben (mit Lupe), Koordinaten relativ zum Videobild
const tapEl = $('tapLayer');
let drag = null;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function normPt(e) { const r = tapEl.getBoundingClientRect(); return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }; }
function hitExisting(pt) {
  const r = tapEl.getBoundingClientRect(), t = state.tap, st = state.step;
  const c = [];
  if (st === 2 && (!t || t === 'lane')) state.lane.forEach((p, i) => c.push({ p, kind: 'lane', i }));
  if (st === 2 && (!t || t === 'calib')) state.calib.forEach((p, i) => c.push({ p, kind: 'calib', i }));
  if (st === 3 && (!t || t === 'person') && personVisible()) c.push({ p: state.personPt, key: 'personPt', kind: 'person' });
  if (st === 3 && state.mode === 'hurdle' && (!t || t === 'hurdle')) state.hurdles.filter(hurdleVisible).forEach((h) => c.push({ p: h, kind: 'hurdle' }));
  let best = null, bd = 30;
  for (const o of c) { const d = Math.hypot((o.p.x - pt.x) * r.width, (o.p.y - pt.y) * r.height); if (d < bd) { bd = d; best = o; } }
  // Person: Antippen irgendwo auf dem erkannten Körper zählt als Treffer
  if (!best && st === 3 && (!t || t === 'person') && personVisible() && state.personPose) {
    const b = bbox(state.personPose.map((q) => ({ x: q[0], y: q[1], visibility: q[2] })));
    if (pt.x >= b.x0 - 0.01 && pt.x <= b.x1 + 0.01 && pt.y >= b.y0 - 0.02 && pt.y <= b.y1 + 0.02) best = { p: state.personPt, key: 'personPt', kind: 'person', body: true };
  }
  return best;
}
const firstFreeHurdle = () => { for (let k = 1; k <= 10; k++) if (!state.hurdles.some((h) => h.nr === k)) return k; return 10; };
function removeHit(hit) {
  if (hit.kind === 'lane') { state.lane.splice(hit.i, 1); $('laneInfo').textContent = ''; if (!state.lane.length && !state.calib.length) state.markT = null; $('setupNext').textContent = 'Überspringen'; setTap('lane'); toast('Punkt entfernt'); }
  else if (hit.kind === 'calib') { state.calib.splice(hit.i, 1); $('calibInfo').textContent = ''; if (!state.lane.length && !state.calib.length) state.markT = null; setTap('calib'); toast('Markierung entfernt'); }
  else if (hit.kind === 'person') { Object.assign(state, { personPt: null, personT: null, personPose: null }); updateTapInfo(); setTap(state.tap); toast('Person-Markierung entfernt'); }
  else if (hit.kind === 'hurdle') { const nr = hit.p.nr; state.hurdles = state.hurdles.filter((h) => h.nr !== nr); $('hurdleNr').value = String(firstFreeHurdle()); renderHurdleChips(); updateTapInfo(); setTap(state.tap); toast(`Hürde ${nr} entfernt`); }
  updateMarkJump();
}
document.body.appendChild($('loupe'));
function showLoupe(pt) {
  const L = $('loupe'), r = $('setupStage').getBoundingClientRect(); const sw = r.width;
  const size = 120, zoom = 3; L.style.display = 'block';
  const fx = r.left + pt.x * r.width, fy = r.top + pt.y * r.height;
  const lx = Math.max(4, Math.min(window.innerWidth - size - 4, fx - size / 2)), ly = Math.max(4, fy - size - 56);
  L.style.left = lx + 'px'; L.style.top = ly + 'px';
  const ctx = L.getContext('2d'), cw = L.width; const srcW = state.W / (sw / size * zoom) ; const srcH = srcW;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, cw);
  try { ctx.drawImage(video, pt.x * state.W - srcW / 2, pt.y * state.H - srcH / 2, srcW, srcH, 0, 0, cw, cw); } catch {}
  ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cw / 2, cw / 2 - 26); ctx.lineTo(cw / 2, cw / 2 - 6); ctx.moveTo(cw / 2, cw / 2 + 6); ctx.lineTo(cw / 2, cw / 2 + 26); ctx.moveTo(cw / 2 - 26, cw / 2); ctx.lineTo(cw / 2 - 6, cw / 2); ctx.moveTo(cw / 2 + 6, cw / 2); ctx.lineTo(cw / 2 + 26, cw / 2); ctx.stroke();
}
function hideLoupe() { $('loupe').style.display = 'none'; }
// Wischen = spulen. Kurz tippen = Punkt setzen bzw. vorhandenen entfernen. Lange drücken = Lupe zum genauen Setzen/Verschieben.
const LONG_MS = 260, MOVE_PX = 9;
// Spulen nach Fingergeschwindigkeit: langsam ziehen = Bild für Bild, schnell ziehen = große Sprünge durchs ganze Video.
// Liefert die bisher zurückgelegten Bilder (Kommazahl) seit Beginn der Geste.
function makeWipe(nFrames, width) {
  let acc = 0, v = 0, lx = null, lt = 0;
  return (x, now) => {
    if (lx == null) { lx = x; lt = now; return 0; }
    const dx = x - lx, dt = Math.max(1, now - lt); lx = x; lt = now;
    v = 0.55 * v + 0.45 * Math.abs(dx) / dt; // Pixel pro Millisekunde, geglättet
    // sehr langsam (unter 50 px/s): ein Bild je 10 px. Normales Tempo: zügig. Schnell: in einem Wisch durchs ganze Video.
    const gMin = 1 / 10, gMax = Math.max(1.2, 2.5 * nFrames / Math.max(200, width)), k = Math.max(0, Math.min(1, (v - 0.05) / 0.6));
    acc += dx * (gMin + (gMax - gMin) * Math.pow(k, 1.3)); return acc;
  };
}
tapEl.addEventListener('pointerdown', (e) => {
  if (!state.duration) return; cancelAuto();
  const pt = normPt(e), hit = hitExisting(pt);
  drag = { hit: hit && !hit.body ? hit : null, bodyHit: hit && hit.body ? hit : null, pt, x0: e.clientX, y0: e.clientY, t0: video.currentTime, w: tapEl.getBoundingClientRect().width || 300, long: false, moved: false, mode: null };
  e.preventDefault(); video.pause(); try { tapEl.setPointerCapture(e.pointerId); } catch {}
  const d = drag;
  if (hit || state.tap) d.timer = setTimeout(() => {
    if (drag !== d || d.mode) return; d.long = true; d.mode = d.hit ? 'move' : state.tap ? 'place' : 'hold';
    if (d.mode === 'hold') return;
    showLoupe(d.pt); drawSetupOverlay(d.hit ? null : d.pt); try { navigator.vibrate && navigator.vibrate(8); } catch {}
  }, LONG_MS);
});
tapEl.addEventListener('pointermove', (e) => {
  if (!drag) return; const d = drag, pt = normPt(e), dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  if (!d.mode) {
    if (Math.hypot(dx, dy) < MOVE_PX) return;
    clearTimeout(d.timer); d.long = true;
    d.mode = d.hit ? 'move' : state.tap && Math.abs(dy) > Math.abs(dx) ? 'place' : 'scrub';
  }
  if (d.mode === 'scrub') { const fF = state.fileFps || 30; if (!d.wf) d.wf = makeWipe(state.duration * fF, d.w); const t = Math.max(0, Math.min(state.duration - 0.001, d.t0 + Math.round(d.wf(e.clientX, e.timeStamp)) / fF)); scrubTo(t); showHud(`${fmt(t, 2)} s`); return; }
  if (d.mode === 'hold') return;
  if (d.mode === 'move') { d.hit.p.x = pt.x; d.hit.p.y = pt.y; d.moved = true; d.pt = pt; showLoupe(pt); drawSetupOverlay(); }
  else { d.pt = pt; showLoupe(pt); drawSetupOverlay(pt); }
});
function endDrag(e, cancelled) {
  if (!drag) return; const d = drag; drag = null; clearTimeout(d.timer); hideLoupe();
  if (d.mode === 'scrub') { hideHud(); drawSetupOverlay(); return; }
  if (!cancelled) {
    if (d.hit && d.moved) {
      if (d.hit.p && d.hit.p.nr != null) refreshHurdleSeg(d.hit.p);
      if (d.hit.key === 'personPt') { state.personPose = null; const tAt = state.personT; detectPersonAt(state.personPt).then((pose) => { if (state.personT === tAt) { state.personPose = pose; drawSetupOverlay(); } }); }
      if (state.lane.length === 2) $('laneInfo').textContent = `Kamera-Neigung ${fmt(laneTilt(), 1)}° – wird ausgeglichen.`;
      toast('Punkt verschoben');
    } else if (d.hit && !d.long) removeHit(d.hit);
    else if (d.bodyHit && !d.long) removeHit(d.bodyHit);
    else if (!d.hit && state.tap && d.mode !== 'hold') commitTap(d.pt);
    else if (!d.hit && !d.bodyHit && !d.long && fsOn) document.body.classList.toggle('fs-clean');
  }
  drawSetupOverlay(); fsRender();
}
tapEl.addEventListener('pointerup', (e) => endDrag(e, false));
tapEl.addEventListener('pointercancel', (e) => endDrag(e, true));
function commitTap(pt) {
  if (state.tap === 'lane' || state.tap === 'calib') { if (state.markT == null || (!state.lane.length && !state.calib.length)) state.markT = video.currentTime; }
  if (state.tap === 'lane') {
    state.lane.push(pt);
    if (state.lane.length >= 2) { setTap(null); $('laneInfo').textContent = `Kamera-Neigung ${fmt(laneTilt(), 1)}° – wird ausgeglichen.`; $('setupNext').textContent = 'Weiter'; toast('Bahnlinie gesetzt'); }
    else setTap('lane');
  } else if (state.tap === 'calib') {
    state.calib.push(pt); if (state.calib.length >= 2) { setTap(null); $('calibInfo').textContent = 'Markierungen gesetzt. Abstand in Metern eintragen.'; toast('Markierungen gesetzt'); } else setTap('calib');
  } else if (state.tap === 'person') {
    state.personPt = pt; state.personT = video.currentTime; state.personPose = null; setTap(null); updateTapInfo(); toast('Erkenne Person …');
    const tAt = state.personT; detectPersonAt(pt).then((pose) => { if (state.personT !== tAt) return; state.personPose = pose; drawSetupOverlay(); toast(pose ? `Person markiert (Bild bei ${fmt(tAt, 2)} s)` : 'Person markiert – Umriss nicht erkannt, Punkt wird verwendet'); });
  }
  else if (state.tap === 'hurdle') {
    const nr = hurdleNr();
    const hd = { nr, x: pt.x, y: pt.y, t: video.currentTime }; refreshHurdleSeg(hd);
    state.hurdles = state.hurdles.filter((h) => h.nr !== nr).concat(hd).sort((a, b) => a.nr - b.nr);
    $('hurdleNr').value = String(firstFreeHurdle());
    setTap('hurdle'); updateTapInfo(); renderHurdleChips(); toast(`Hürde ${nr} markiert (Bild bei ${fmt(video.currentTime, 2)} s)`);
  }
  updateMarkJump();
}
const offMarkFrame = () => state.markT != null && Math.abs(video.currentTime - state.markT) > frameDur() * 1.5;
function updateMarkJump() {
  const b = $('markJump'); b.hidden = state.markT == null || !offMarkFrame();
  if (!b.hidden) b.textContent = `Zum Bild der Markierung (${fmt(state.markT, 2)} s)`;
}
$('markJump').onclick = () => { video.pause(); seekTo(state.markT).then(() => { updateMarkJump(); drawSetupOverlay(); }); };
$('laneReset').onclick = () => { state.lane = []; if (!state.calib.length) state.markT = null; $('laneInfo').textContent = ''; setStep(2); };
$('tapPerson').onclick = () => setTap(state.tap === 'person' ? null : 'person');
$('calibBtn').onclick = () => { if (state.tap === 'calib') { setTap(null); return; } state.calib = []; if (!state.lane.length) state.markT = null; setTap('calib'); drawSetupOverlay(); };
$('tapHurdle').onclick = () => setTap(state.tap === 'hurdle' ? null : 'hurdle');
$('hurdleNr').onchange = () => setTap(state.tap === 'hurdle' ? 'hurdle' : null);
function hurdleNr() { return parseInt($('hurdleNr').value, 10) || 1; }
// Hürde im aktuellen Bild sichtbar? Stativ: immer (steht still). Mitschwenken: nur im Bild der Markierung.
function hurdleVisible(h) { return Math.abs(video.currentTime - h.t) <= frameDur() * 2.5; }
const personVisible = () => state.personPt && (state.personT == null || Math.abs(video.currentTime - state.personT) <= frameDur() * 2.5);
// Umriss eines Objekts um die angetippte Stelle: Pixel, die sich deutlich von der Bahn ringsum abheben und mit der Stelle verbunden sind
function segmentAt(pt) {
  const S = 420 / Math.max(state.W, state.H), w = Math.max(10, Math.round(state.W * S)), h = Math.max(10, Math.round(state.H * S));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  let d; try { g.drawImage(video, 0, 0, w, h); d = g.getImageData(0, 0, w, h).data; } catch { return null; }
  const tx = Math.round(pt.x * (w - 1)), ty = Math.round(pt.y * (h - 1));
  const x0 = Math.max(0, tx - Math.round(0.12 * w)), x1 = Math.min(w - 1, tx + Math.round(0.12 * w)), y0 = Math.max(0, ty - Math.round(0.1 * h)), y1 = Math.min(h - 1, ty + Math.round(0.28 * h));
  const mw = x1 - x0 + 1, mh = y1 - y0 + 1;
  const br = [], bg = [], bb = [];
  const push = (x, y) => { const i = (y * w + x) * 4; br.push(d[i]); bg.push(d[i + 1]); bb.push(d[i + 2]); };
  for (let x = x0; x <= x1; x += 2) { push(x, y0); push(x, y1); } for (let y = y0; y <= y1; y += 2) { push(x0, y); push(x1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1]; const R = med(br), G = med(bg), B = med(bb);
  const dist = (x, y) => { const i = (y * w + x) * 4; return Math.hypot(d[i] - R, d[i + 1] - G, d[i + 2] - B); };
  let sx = -1, sy = -1, best = 0;
  for (let y = Math.max(y0, ty - 3); y <= Math.min(y1, ty + 3); y++) for (let x = Math.max(x0, tx - 3); x <= Math.min(x1, tx + 3); x++) { const v = dist(x, y); if (v > best) { best = v; sx = x; sy = y; } }
  if (best < 40) return null;
  // Region wachsen lassen; wird sie zu groß oder läuft in den Bildrand des Fensters (= Hintergrund), strenger werden
  let mask = null, cnt = 0;
  for (const f of [0.4, 0.55, 0.7, 0.82]) {
    const tol = Math.max(32, best * f), m = new Uint8Array(mw * mh), st = [[sx, sy]]; let c = 0, touch = 0, minX = sx, maxX = sx, minY = sy, maxY = sy;
    m[(sy - y0) * mw + (sx - x0)] = 1;
    while (st.length && c < 0.3 * mw * mh) {
      const [x, y] = st.pop(); c++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue; const k = (ny - y0) * mw + (nx - x0);
        if (m[k] || dist(nx, ny) < tol) continue; m[k] = 1; st.push([nx, ny]);
      }
    }
    touch = (minX <= x0) + (maxX >= x1) + (minY <= y0) + (maxY >= y1);
    const boxFill = c / ((maxX - minX + 1) * (maxY - minY + 1));
    if (c >= 6 && c < 0.22 * mw * mh && touch <= 1 && !(boxFill > 0.85 && c > 0.08 * mw * mh)) { mask = m; cnt = c; break; }
  }
  if (!mask) return null;
  // Oberkante unter dem Finger: oberster Maskenpunkt in den Spalten um die Stelle
  let top = Infinity; for (let x = Math.max(x0, tx - 2); x <= Math.min(x1, tx + 2); x++) for (let y = y0; y <= y1; y++) if (mask[(y - y0) * mw + (x - x0)]) { top = Math.min(top, y); break; }
  const cv = document.createElement('canvas'); cv.width = mw; cv.height = mh; const cx = cv.getContext('2d'), img = cx.createImageData(mw, mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const k = y * mw + x; if (!mask[k]) continue;
    const edge = x === 0 || y === 0 || x === mw - 1 || y === mh - 1 || !mask[k - 1] || !mask[k + 1] || !mask[k - mw] || !mask[k + mw];
    const o = k * 4; if (edge) { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = 255; } else { img.data[o] = 47; img.data[o + 1] = 111; img.data[o + 2] = 235; img.data[o + 3] = 120; }
  }
  cx.putImageData(img, 0, 0);
  return { cv, x: x0 / w, y: y0 / h, ww: mw / w, hh: mh / h, topY: Number.isFinite(top) && Math.abs(top - ty) < 0.08 * h ? top / (h - 1) : null };
}
function refreshHurdleSeg(hd) { const sg = segmentAt(hd); hd.seg = sg; if (sg && sg.topY != null) hd.y = sg.topY; }
async function detectPersonAt(pt) {
  try {
    const lmk = await getLandmarker(() => {});
    state.tsBase = (state.tsBase || 0) + 1;
    const r = lmk.detectForVideo(video, state.tsBase); const p = pickPose((r && r.landmarks) || [], null, pt);
    return p ? p.map((q) => [q.x, q.y, q.visibility ?? 1]) : null;
  } catch { return null; }
}
function renderHurdleChips() {
  $('hurdleChips').innerHTML = state.hurdles.length ? state.hurdles.map((h) => `<button class="chip" data-hj="${h.nr}"><span class="dot" style="background:#2F6FEB"></span>H${h.nr} · ${fmt(h.t, 2)} s<span data-hdel="${h.nr}" aria-label="Hürde ${h.nr} löschen" style="margin-left:4px;color:var(--muted);padding:0 2px">✕</span></button>`).join('') : '<span class="hint small">Noch keine Hürde markiert.</span>';
}
$('hurdleChips').addEventListener('click', (e) => {
  const d = e.target.closest('[data-hdel]');
  if (d) { const nr = +d.dataset.hdel; state.hurdles = state.hurdles.filter((h) => h.nr !== nr); $('hurdleNr').value = String(firstFreeHurdle()); renderHurdleChips(); updateTapInfo(); setTap(state.tap); drawSetupOverlay(); return; }
  const b = e.target.closest('[data-hj]'); if (!b) return;
  const h = state.hurdles.find((x) => x.nr === +b.dataset.hj); $('hurdleNr').value = String(h.nr); setTap(null);
  video.pause(); seekTo(h.t).then(drawSetupOverlay);
});
function updateTapInfo() {
  const t = [state.personPt ? `Person markiert (Bild bei ${fmt(state.personT, 2)} s).` : 'Nur nötig, wenn mehrere Personen im Bild sind.'];
  if (state.mode === 'hurdle') t.push(state.hurdles.length ? `${state.hurdles.length} Hürde(n) markiert.` : 'Noch keine Hürde markiert.');
  $('tapInfo').textContent = t.join(' ');
}

// ======================= Vollbild-Editor =======================
const preferFs = () => true; // der Editor läuft überall im Vollbild
// Im Vollbild wird das Videobild selbst auf eine Leinwand gemalt – iOS zeigt das <video> in festen Ebenen sonst oft schwarz.
let fsLoop = 0, ambT = 0;
// weiches Umgebungslicht: das aktuelle Videobild stark verkleinert und per CSS weichgezeichnet hinter den Glasflächen
function fsDrawFrame() {
  if (!fsOn || video.readyState < 2) return;
  const c = $('fsAmb'); try { c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); } catch {}
}
function fsPlayLoop() {
  cancelAnimationFrame(fsLoop);
  const tick = (now) => { if (video.paused || curScreen !== 's-setup') return; paintPlayhead(); if (!ambT || now - ambT > 200) { ambT = now; fsDrawFrame(); } fsLoop = requestAnimationFrame(tick); };
  fsLoop = requestAnimationFrame(tick);
}
['seeked', 'loadeddata', 'canplay'].forEach((ev) => video.addEventListener(ev, () => fsDrawFrame()));
video.addEventListener('play', () => fsPlayLoop());
// iOS dekodiert nach dem Umhängen eines pausierten Videos oft kein Bild mehr (readyState 1) – kurz stumm anspielen, dann zurück an die Stelle.
function kickVideo() {
  if (!video.src) return;
  lastSeekT = null; const t0 = video.currentTime; video.muted = true;
  const back = () => { video.pause(); const t = lastSeekT != null ? lastSeekT : t0; seekTo(t).then(() => { fsDrawFrame(); drawSetupOverlay(); }); };
  try { const p = video.play(); if (p && p.then) p.then(back).catch(() => seekTo(t0 + 0.0001)); else back(); } catch { seekTo(t0 + 0.0001); }
}
function syncLoadBtn() { const b = $('vLoad'); if (b) b.hidden = !(curScreen === 's-setup' && video.src && video.readyState < 2); }
['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'emptied'].forEach((ev) => video.addEventListener(ev, syncLoadBtn));
// Muss direkt im Tipp-Handler laufen: iOS lädt Videobilder in der App erst nach einer echten Berührung
$('vLoad').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const t = video.currentTime; try { const p = video.play(); if (p && p.then) p.then(() => { video.pause(); video.currentTime = t; }).catch(() => {}); } catch {} setTimeout(() => { syncLoadBtn(); maybeAuto(); }, 700); });
function setFs(on) {
  on = !!on; if (on === fsOn) return;
  const media = document.querySelector('.setup-media'); if (!media) return;
  const split = media.parentElement, stage = $('setupStage');
  // Kein position:fixed rund ums Video und kein Umhängen des Videos (beides macht es in der iOS-App schwarz).
  // Stattdessen wird die Einrichten-Seite selbst bildschirmfüllend: Kopf, Tab-Leiste und Karten verschwinden, Leiste und Werkzeuge kommen in den normalen Seitenfluss.
  const parts = [...media.children].filter((el) => el !== stage);
  if (on) {
    fsHome = parts; $('fsClose').hidden = preferFs();
    split.insertBefore($('fsAmb'), split.firstChild);
    split.insertBefore($('fsBar'), media);
    parts.forEach((el) => $('fsMedia').appendChild(el));
    split.insertBefore($('fsSide'), media.nextSibling);
    document.body.classList.add('fs-on'); fsOn = true; window.scrollTo(0, 0);
  } else {
    (fsHome || []).forEach((el) => media.appendChild(el)); fsHome = null;
    $('fsEd').appendChild($('fsAmb')); $('fsEd').appendChild($('fsBar')); $('fsEd').appendChild($('fsSide'));
    document.body.classList.remove('fs-on', 'fs-clean'); fsOn = false;
  }
  requestAnimationFrame(() => { sizeOverlay(); drawSetupOverlay(); fsRender(); fsDrawFrame(); });
  setTimeout(() => { if (curScreen === 's-setup') { sizeOverlay(); drawSetupOverlay(); fsDrawFrame(); } }, 350);
}
$('fsOpen').onclick = (e) => { e.preventDefault(); e.stopPropagation(); setFs(true); };
$('fsClose').onclick = () => setFs(false);
$('fsBack').onclick = () => { if (state.step === 1) { setFs(false); video.pause(); showScreen('s-pick'); } else setStep(state.step - 1); };
$('fsNext').onclick = goNext;
const STEP_HELP = {
  1: ['Ausschnitt wählen', ['Nach dem Laden sucht die App dich selbst im Video und schlägt einen Ausschnitt vor. Mit den <b>gelben Griffen</b> in der Zeitleiste passt du Anfang und Ende an.', '<b>Über das Video wischen</b> spult Bild für Bild. Die Pfeiltasten gehen genau ein Bild vor oder zurück.', 'Kürze auf die Schritte, in denen du mit ganzem Körper durchs Bild läufst. Mehr als 6000 Bilder gehen nicht.', '<b>Kamera:</b> „Kamera folgt“ passt, wenn das Handy mitschwenkt. „Stativ“ nur wählen, wenn das Bild komplett stillsteht.', '<b>Bildrate:</b> Hast du in Zeitlupe gefilmt und das Video läuft langsam ab, wähle die Bildrate der Aufnahme (meist 240). Eine unmögliche Schrittfrequenz korrigiert die App nach der Analyse selbst.']],
  2: ['Bahnlinie markieren', ['Dieser Schritt ist freiwillig. Tippe <b>zwei Punkte auf einer Bahnlinie</b> nah an deinen Füßen an, möglichst weit auseinander. Die Linie sagt der Analyse, was waagrecht ist.', 'Kurz tippen setzt einen Punkt, nochmal auf den Punkt tippen entfernt ihn. <b>Lange drücken</b> zeigt die Lupe zum genauen Setzen oder Verschieben.', 'Aus der Hand gefilmt und das Bild kippt hin und her? Dann überspringen. Die Neigung wird aus deinen Fußkontakten geschätzt.', '<b>Abstand A–B</b> (nur mit Stativ): Stehen zwei Markierungen mit bekanntem Abstand in deiner eigenen Bahn, setze beide und trage die Meter ein. Dann werden Schrittlänge und Tempo genau.']],
  3: ['Details', ['<b>Größe:</b> daraus werden Längen und Tempo berechnet.', '<b>Phase:</b> „automatisch“ erkennt selbst, ob Start, Beschleunigung oder Maximaltempo. Danach richten sich die Richtwerte.', '<b>Mich markieren:</b> nur nötig, wenn mehrere Personen im Bild sind. Kurz auf dich tippen.', '<b>Hürden:</b> werden von selbst erkannt, mit Zeiten und Schritten von Hürde zu Hürde. Wer zusätzlich Absprung- und Landedistanz will, wählt „Hürden antippen“ und tippt kurz vor dem Angriff auf die Oberkante jeder Hürde.']],
};
$('fsHelp').onclick = () => { cancelAuto(); const [t, ps] = STEP_HELP[state.step]; openSheet(`<h2>${t}</h2>${ps.map((p) => `<p>${p}</p>`).join('')}<div class="foot"><button class="btn primary block" data-ok>Verstanden</button></div>`, (el) => { el.querySelector('[data-ok]').onclick = () => closeSheet(true); }); };
document.addEventListener('fullscreenchange', () => { setTimeout(() => { if (fsOn) { sizeOverlay(); drawSetupOverlay(); } }, 60); });
window.addEventListener('orientationchange', () => setTimeout(() => { if (curScreen === 's-setup') { sizeOverlay(); drawSetupOverlay(); } }, 250));
function fsRender() {
  if (!fsOn) return;
  const n = state.step, t = state.tap;
  $('fsTitle').innerHTML = `${esc(STEP_TXT[n][0])}<small>${n === 3 ? 2 : 1} von 2</small>`;
  $('fsNextTx').textContent = n === 3 ? 'Analysieren' : n === 2 && state.lane.length < 2 ? 'Überspringen' : 'Weiter';
  let hint = '', warn = false;
  const tool = (id, label, col, on, done, extra = '') => `<button class="fs-tool${on ? ' on' : ''}${done ? ' done' : ''}${extra}" data-fs="${id}">${col ? `<i style="background:${col}"></i>` : ''}${esc(label)}</button>`;
  const seg = (id, opts, cur) => `<div class="fs-seg" data-fsseg="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  let h = '';
  if (n === 1) {
    const sSet = state.start > 0.001, eSet = state.end < state.duration - 0.001, fr = rangeFrames();
    h += tool('auto', autoBusy ? 'Suche läuft …' : 'Mich finden', '', false, false, ' accent');
    h += tool('start', sSet ? `Start ${fmt(state.start, 2)} s` : 'Start hier', '', false, sSet);
    h += tool('end', eSet ? `Ende ${fmt(state.end, 2)} s` : 'Ende hier', '', false, eSet);
    h += seg('cam', [['pan', 'Kamera folgt'], ['fixed', 'Stativ']], state.camera);
    const cur = $('fps').value || String(state.fileFps);
    h += `<select data-fssel="fps" aria-label="Bildrate der Aufnahme">${[...$('fps').options].map((o) => `<option value="${o.value}" ${o.value === cur ? 'selected' : ''}>${+o.value === state.fileFps ? `${o.value} fps (wie Datei)` : `Gefilmt mit ${o.value} fps`}</option>`).join('')}</select>`;
    warn = fr > 6000;
    hint = autoBusy ? 'Die App sucht dich im Video. Tippen bricht ab.' : warn ? `${fr} Bilder sind zu viel. Gelbe Griffe zusammenziehen, höchstens 6000.` : (fr > 1500 ? `${fr} Bilder. Die Analyse dauert dann auf dem Handy einige Minuten.` : `${fr} Bilder. Griffe kürzen, Wischen spult.`);
  } else if (n === 2) {
    h += tool('lane', state.lane.length === 2 ? 'Bahnlinie ✓' : t === 'lane' ? `Bahnlinie: Punkt ${state.lane.length + 1}` : 'Bahnlinie', '#ffd60a', t === 'lane', state.lane.length === 2);
    if (state.camera === 'fixed') {
      h += tool('calib', state.calib.length === 2 ? 'Abstand A–B ✓' : t === 'calib' ? `Markierung ${state.calib.length ? 'B' : 'A'}` : 'Abstand A–B', '#30D158', t === 'calib', state.calib.length === 2);
      if (state.calib.length === 2) h += `<label class="fs-field">A–B<input data-fsin="calibM" inputmode="decimal" placeholder="?" value="${esc($('calibM').value)}" aria-label="Abstand in Metern"><span>m</span></label>`;
    }
    if (state.markT != null && offMarkFrame()) h += tool('markjump', 'Zum Markierungsbild', '', false, false);
    hint = t === 'lane' ? (state.lane.length ? 'Zweiten Punkt auf derselben Bahnlinie antippen.' : 'Freiwillig: zwei Punkte auf einer Bahnlinie bei deinen Füßen antippen. Wischen spult.') : t === 'calib' ? `Markierung ${state.calib.length ? 'B' : 'A'} antippen.` : 'Punkt antippen entfernt ihn, lange drücken verschiebt ihn mit Lupe.';
  } else {
    h += seg('mode', [['sprint', 'Automatisch'], ['hurdle', 'Hürden antippen']], state.mode);
    h += `<label class="fs-field">Größe<input data-fsin="height" inputmode="numeric" value="${esc($('height').value)}" aria-label="Körpergröße in cm"><span>cm</span></label>`;
    h += `<select data-fssel="phase" aria-label="Laufphase">${[['auto', 'Phase: automatisch'], ['start', 'Phase: Start'], ['accel', 'Phase: Beschleunigung'], ['maxv', 'Phase: Maximaltempo']].map(([v, l]) => `<option value="${v}" ${v === state.phase ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    h += tool('person', state.personPt ? 'Ich ✓' : t === 'person' ? 'Tippe auf dich' : 'Mich markieren', '#FF5A2E', t === 'person', !!state.personPt);
    if (state.mode === 'hurdle') {
      const nr = hurdleNr();
      h += tool('hurdle', t === 'hurdle' ? `Hürde ${nr} setzen` : `Hürden (${state.hurdles.length})`, '#2F6FEB', t === 'hurdle', false);
      h += `<select data-fssel="hurdleNr" aria-label="Hürde Nr.">${[1,2,3,4,5,6,7,8,9,10].map((k) => `<option value="${k}" ${k === nr ? 'selected' : ''}>Nr. ${k}${state.hurdles.some((x) => x.nr === k) ? ' ✓' : ''}</option>`).join('')}</select>`;
    }
    hint = t === 'hurdle' ? `Freiwillig, für Abstände zur Hürde: kurz vor dem Angriff die Oberkante von Hürde ${hurdleNr()} antippen.` : t === 'person' ? (state.multi ? 'Mehrere Personen im Bild: tippe kurz auf dich.' : 'Tippe kurz auf dich.') : state.multi && !state.personPt ? 'Mehrere Personen im Bild: „Mich markieren“ wählen.' : 'Größe prüfen, dann analysieren. Hürden werden von selbst erkannt.';
  }
  // ein Eingabefeld, in dem gerade getippt wird, nicht neu aufbauen
  const ae = document.activeElement;
  if (!(ae && ae.tagName === 'INPUT' && $('fsTools').contains(ae))) $('fsTools').innerHTML = h;
  const hi = $('fsHint'); hi.textContent = hint; hi.classList.toggle('warn', warn);
}
$('fsTools').addEventListener('click', (e) => {
  const sb = e.target.closest('[data-fsseg] button');
  if (sb) { cancelAuto(); const id = sb.parentElement.dataset.fsseg, v = sb.dataset.v; if (id === 'cam') { segCam.set(v); state.camera = v; syncCalibSect(); } if (id === 'mode') { segMode.set(v); state.mode = v; $('hurdleBox').hidden = v !== 'hurdle'; setTap(v === 'hurdle' ? 'hurdle' : null); updateTapInfo(); drawSetupOverlay(); } fsRender(); return; }
  const b = e.target.closest('[data-fs]'); if (!b) return; const k = b.dataset.fs;
  if (k === 'auto') { if (autoBusy) cancelAuto(); else autoFindRunner(true); return; }
  cancelAuto();
  if (k === 'start') $('setStart').click();
  else if (k === 'end') $('setEnd').click();
  else if (k === 'lane') { if (state.tap === 'lane') setTap(null); else if (state.lane.length >= 2) $('laneReset').click(); else setTap('lane'); }
  else if (k === 'calib') $('calibBtn').click();
  else if (k === 'markjump') $('markJump').click();
  else if (k === 'person') setTap(state.tap === 'person' ? null : 'person');
  else if (k === 'hurdle') setTap(state.tap === 'hurdle' ? null : 'hurdle');
  fsRender(); drawSetupOverlay();
});
$('fsTools').addEventListener('change', (e) => {
  const s = e.target.closest('[data-fssel]'); if (!s) return;
  if (s.dataset.fssel === 'fps') { $('fps').value = s.value; $('fps').dispatchEvent(new Event('change')); }
  if (s.dataset.fssel === 'hurdleNr') { $('hurdleNr').value = s.value; setTap('hurdle'); }
  if (s.dataset.fssel === 'phase') { state.phase = s.value; segPhase.set(s.value); }
  fsRender();
});
$('fsTools').addEventListener('input', (e) => {
  const i = e.target.closest('[data-fsin]'); if (!i) return;
  if (i.dataset.fsin === 'calibM') $('calibM').value = i.value;
  if (i.dataset.fsin === 'height') { $('height').value = i.value; state.heightTouched = true; }
});
$('fsTools').addEventListener('focusout', () => setTimeout(fsRender, 0));
function laneTilt() { if (state.lane.length < 2) return 0; let [a, b] = state.lane; if (b.x < a.x) [a, b] = [b, a]; return Math.atan2((b.y - a.y) * state.H, (b.x - a.x) * state.W) * 180 / Math.PI; }
function sizeStage() {
  const st = $('setupStage'); if (!state.W || !state.H) return;
  let avail, maxH;
  if (fsOn) {
    const m = document.querySelector('.setup-media'), r = { width: m.clientWidth, height: m.clientHeight }; if (r.width < 20 || r.height < 20) { requestAnimationFrame(() => { if (fsOn) { sizeOverlay(); drawSetupOverlay(); } }); return; }
    const w = Math.min(r.width, r.height * state.W / state.H), h = w * state.H / state.W;
    Object.assign(st.style, { width: w + 'px', height: h + 'px' });
    return;
  }
  avail = st.parentElement.clientWidth || st.clientWidth; maxH = Math.max(180, window.innerHeight * (window.innerWidth < 900 ? 0.42 : 0.62));
  const w = Math.max(10, Math.min(avail, maxH * state.W / state.H)); st.style.width = w + 'px'; st.style.height = (w * state.H / state.W) + 'px';
}
function sizeOverlay() { sizeStage(); fsDrawFrame(); const c = $('setupOvl'); const r = c.getBoundingClientRect(); c.width = Math.max(10, Math.round(r.width * devicePixelRatio)); c.height = Math.max(10, Math.round(r.height * devicePixelRatio)); }
window.addEventListener('resize', () => { if (curScreen === 's-setup') { sizeOverlay(); drawSetupOverlay(); } });
function drawSetupOverlay(tempPt) {
  const c = $('setupOvl'); if (!c.width) sizeOverlay(); const ctx = c.getContext('2d'); const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H); updateMarkJump(); syncLoadBtn();
  const off = offMarkFrame() && state.camera === 'pan';
  ctx.globalAlpha = off ? 0.35 : 1;
  const label = (txt, x, y, col) => { ctx.save(); ctx.font = `600 ${13 * devicePixelRatio}px -apple-system, system-ui`; const tw = ctx.measureText(txt).width, pad = 6 * devicePixelRatio, hh = 20 * devicePixelRatio; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - hh + 4 * devicePixelRatio, tw + 2 * pad, hh, 8 * devicePixelRatio) : ctx.rect(x, y - hh + 4 * devicePixelRatio, tw + 2 * pad, hh); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, x + pad, y); ctx.restore(); };
  const hurdleIcon = (p, txt) => { const x = p.x * W, y = p.y * H, r = 9 * devicePixelRatio; ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * devicePixelRatio; ctx.setLineDash([5 * devicePixelRatio, 4 * devicePixelRatio]); ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, y + 60 * devicePixelRatio); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#2F6FEB'; ctx.lineWidth = 3 * devicePixelRatio; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.restore(); label(txt, x + r + 6 * devicePixelRatio, y + 5 * devicePixelRatio, '#2F6FEB'); };
  const dot = (p, col, label) => { ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * devicePixelRatio; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 8 * devicePixelRatio, 0, 7); ctx.fill(); ctx.stroke(); if (label) { ctx.font = `600 ${13 * devicePixelRatio}px -apple-system, system-ui`; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4; ctx.fillText(label, p.x * W + 12 * devicePixelRatio, p.y * H - 10 * devicePixelRatio); ctx.shadowBlur = 0; } };
  if (state.lane.length) {
    if (state.lane.length === 2) {
      const [a, b] = state.lane; const dx = (b.x - a.x) * W, dy = (b.y - a.y) * H; const k = 3;
      ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 3 * devicePixelRatio; ctx.setLineDash([12 * devicePixelRatio, 8 * devicePixelRatio]);
      ctx.beginPath(); ctx.moveTo(a.x * W - dx * k, a.y * H - dy * k); ctx.lineTo(b.x * W + dx * k, b.y * H + dy * k); ctx.stroke(); ctx.setLineDash([]);
    }
    state.lane.forEach((p) => dot(p, '#ffd60a'));
  }
  state.calib.forEach((p, i) => dot(p, '#30D158', i ? 'B' : 'A'));
  if (state.calib.length === 2) { ctx.strokeStyle = '#30D158'; ctx.lineWidth = 3 * devicePixelRatio; ctx.beginPath(); ctx.moveTo(state.calib[0].x * W, state.calib[0].y * H); ctx.lineTo(state.calib[1].x * W, state.calib[1].y * H); ctx.stroke(); }
  if (personVisible()) {
    if (state.personPose) {
      drawPose(ctx, state.personPose, W, H, { alpha: 0.95 });
      const b = bbox(state.personPose.map((q) => ({ x: q[0], y: q[1], visibility: q[2] }))); ctx.save(); ctx.strokeStyle = '#C2362B'; ctx.lineWidth = 3 * devicePixelRatio; ctx.setLineDash([10 * devicePixelRatio, 6 * devicePixelRatio]);
      const px = 0.15 * (b.x1 - b.x0); ctx.strokeRect((b.x0 - px) * W, (b.y0 - 0.03) * H, (b.x1 - b.x0 + 2 * px) * W, (b.y1 - b.y0 + 0.06) * H); ctx.restore();
      label('ich', (b.x1 + px) * W + 6 * devicePixelRatio, (b.y0 + 0.02) * H, '#C2362B');
    } else dot(state.personPt, '#C2362B', 'ich');
  }
  if (state.mode === 'hurdle') for (const h of state.hurdles) if (hurdleVisible(h)) {
    if (h.seg) { ctx.drawImage(h.seg.cv, h.seg.x * W, h.seg.y * H, h.seg.ww * W, h.seg.hh * H); label('Hürde ' + h.nr, h.x * W + 12 * devicePixelRatio, h.y * H - 12 * devicePixelRatio, '#2F6FEB'); }
    else hurdleIcon(h, 'Hürde ' + h.nr);
  }
  ctx.globalAlpha = 1;
  if (tempPt) { const col = state.tap === 'calib' ? '#30D158' : state.tap === 'person' ? '#C2362B' : state.tap === 'hurdle' ? '#2F6FEB' : '#ffd60a'; dot(tempPt, col); if (state.tap === 'lane' && state.lane.length === 1) { ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2 * devicePixelRatio; ctx.setLineDash([8 * devicePixelRatio, 6 * devicePixelRatio]); ctx.beginPath(); ctx.moveTo(state.lane[0].x * W, state.lane[0].y * H); ctx.lineTo(tempPt.x * W, tempPt.y * H); ctx.stroke(); ctx.setLineDash([]); } }
}

// ======================= Pose-Erkennung =======================
let landmarkerPromise = null;
// Eigenes Körpermodell (größere, genauere Variante für den PC) liegt in der Browser-Datenbank dieses Geräts
const mdb = () => new Promise((res, rej) => { const q = indexedDB.open('sprintanalyse-model', 1); q.onupgradeneeded = () => q.result.createObjectStore('m'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
async function modelGet() { try { const db = await mdb(); return await new Promise((res) => { const q = db.transaction('m').objectStore('m').get('custom'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function modelPut(v) { const db = await mdb(); return new Promise((res, rej) => { const tx = db.transaction('m', 'readwrite'); if (v) tx.objectStore('m').put(v, 'custom'); else tx.objectStore('m').delete('custom'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function modelInfo() { const cm = await modelGet(); $('mdInfo').textContent = cm && cm.buf ? `Aktiv: ${cm.name} (${Math.round(cm.buf.byteLength / 1e6)} MB). Gilt nur in diesem Browser.` : 'Aktiv: das eingebaute Modell.'; $('mdClear').hidden = !(cm && cm.buf); }
$('mdFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size < 2e6 || f.size > 80e6) return toast('Das sieht nicht nach der Modelldatei aus.');
  try { await modelPut({ name: f.name, buf: await f.arrayBuffer() }); landmarkerPromise = null; toast('Modell gespeichert. Es gilt ab der nächsten Analyse.'); } catch { toast('Speichern nicht möglich. Der Browser lässt hier keine große Datei zu.'); }
  modelInfo();
});
$('mdClear').onclick = async () => { try { await modelPut(null); } catch {} landmarkerPromise = null; modelInfo(); toast('Eingebautes Modell aktiv'); };
modelInfo();
async function getLandmarker(progress) {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('./vision_bundle.mjs');
      const fileset = { wasmLoaderPath: new URL('wasm/vision_wasm_internal.js', location.href).href, wasmBinaryPath: new URL('wasm/vision_wasm_internal.wasm', location.href).href };
      const make = async (buf) => {
        const opts = (delegate) => ({ baseOptions: { modelAssetBuffer: buf, delegate }, runningMode: 'VIDEO', numPoses: 3, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
        if (window.__forceCPU) return PoseLandmarker.createFromOptions(fileset, opts('CPU'));
        try { return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
        catch { progress && progress('Grafikbeschleunigung nicht verfügbar – nutze CPU (langsamer)'); return PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
      };
      const cm = await modelGet();
      if (cm && cm.buf) { try { progress && progress('Lade dein genaueres Modell'); return await make(new Uint8Array(cm.buf.slice(0))); } catch { toast('Dein Modell ließ sich nicht laden. Es läuft das eingebaute.'); } }
      const resp = await fetch(new URL('models/pose_model.wasm', location.href).href);
      if (!resp.ok) throw new Error('Modell nicht gefunden (' + resp.status + ')');
      return make(new Uint8Array(await resp.arrayBuffer()));
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}
function bbox(lm) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) { if ((p.visibility ?? 1) < 0.3) continue; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0 };
}
function pickPose(poses, prev, target) {
  if (!poses || !poses.length) return null;
  if (poses.length === 1 && !prev && !target) return poses[0];
  if (!prev && target) {
    // Nur eine Person nehmen, die wirklich an der angetippten Stelle ist – sonst lieber noch keine
    let best = null, bs = Infinity;
    for (const p of poses) {
      const b = bbox(p), padX = (b.x1 - b.x0) * 0.25 + 0.02, padY = b.h * 0.1 + 0.02;
      const inside = target.x >= b.x0 - padX && target.x <= b.x1 + padX && target.y >= b.y0 - padY && target.y <= b.y1 + padY;
      const d = Math.hypot(b.cx - target.x, b.cy - target.y);
      if (!inside && d > 0.12) continue;
      const sc = (inside ? 0 : 1) + d; if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }
  let best = null, bs = Infinity;
  for (const p of poses) {
    const b = bbox(p); let s;
    if (prev) {
      // Eine Person springt nicht: erwartet wird sie dort, wohin sie sich zuletzt bewegt hat, und etwa gleich groß
      const pb = bbox(prev), lost = prev._lost || 0;
      if (b.h > 2.2 * pb.h || b.h < 0.4 * pb.h) continue;
      s = Math.hypot(b.cx - (pb.cx + (prev._vx || 0) * (lost + 1)), b.cy - (pb.cy + (prev._vy || 0) * (lost + 1))) + Math.abs(b.h - pb.h);
    }
    else if (target) { const inside = target.x >= b.x0 && target.x <= b.x1 && target.y >= b.y0 && target.y <= b.y1; s = (inside ? 0 : 1) + Math.hypot(b.cx - target.x, b.cy - target.y); }
    else s = -b.h;
    if (s < bs) { bs = s; best = p; }
  }
  if (prev) { const pb = bbox(prev); if (bs > Math.min(0.25, Math.max(0.035, 0.9 * pb.h) * (1 + 0.4 * (prev._lost || 0)))) return null; }
  return best;
}
const CONN = [[11, 12, 'c'], [11, 23, 'L'], [12, 24, 'R'], [23, 24, 'c'], [11, 13, 'L'], [13, 15, 'L'], [12, 14, 'R'], [14, 16, 'R'], [23, 25, 'L'], [25, 27, 'L'], [27, 29, 'L'], [29, 31, 'L'], [27, 31, 'L'], [24, 26, 'R'], [26, 28, 'R'], [28, 30, 'R'], [30, 32, 'R'], [28, 32, 'R']];
function drawPose(ctx, lm, W, H, o = {}) {
  if (!lm) return;
  const s = Math.max(1.5, W / 520); ctx.save(); ctx.lineCap = 'round'; ctx.globalAlpha = o.alpha ?? 1;
  for (const [a, b, side] of CONN) {
    const p = lm[a], q = lm[b]; if (!p || !q || p[2] < 0.3 || q[2] < 0.3) continue;
    ctx.strokeStyle = side === 'L' ? '#E4572E' : side === 'R' ? '#2E86DE' : '#ffffff'; ctx.lineWidth = s * 1.8;
    ctx.beginPath(); ctx.moveTo(p[0] * W, p[1] * H); ctx.lineTo(q[0] * W, q[1] * H); ctx.stroke();
  }
  ctx.fillStyle = '#fff'; for (let k = 11; k < 33; k++) { const p = lm[k]; if (!p || p[2] < 0.3) continue; ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, s * 1.7, 0, 7); ctx.fill(); }
  if (o.contactSide) { ctx.fillStyle = '#30D158'; for (const k of (o.contactSide === 'L' ? [29, 31] : [30, 32])) { const p = lm[k]; if (p) { ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, s * 4, 0, 7); ctx.fill(); } } }
  ctx.restore();
}
// Bahnlinien im Bild finden: weiße Linien nahe den Füßen, Richtung per Projektion (Radon)
const laneCv = document.createElement('canvas'), laneCtx = laneCv.getContext('2d', { willReadFrequently: true });
function detectLane(footY) {
  const sw = 320, sh = Math.max(40, Math.round(320 * state.H / state.W));
  if (laneCv.width !== sw || laneCv.height !== sh) { laneCv.width = sw; laneCv.height = sh; }
  let y0n = 0.5, y1n = 1; if (Number.isFinite(footY)) { y0n = Math.max(0, footY - 0.1); y1n = Math.min(1, footY + 0.22); }
  const y0 = Math.floor(y0n * sh), y1 = Math.ceil(y1n * sh), bh = y1 - y0; if (bh < 6) return null;
  try { laneCtx.drawImage(video, 0, 0, sw, sh); } catch { return null; }
  // Linie = heller, wenig farbiger Strich, der sich vom Boden direkt darüber und darunter abhebt (klappt auf roter und auf heller Bahn)
  const gy0 = Math.max(0, y0 - 4), gh = Math.min(sh, y1 + 4) - gy0;
  const d = laneCtx.getImageData(0, gy0, sw, gh).data, gray = new Float32Array(sw * gh), sat = new Float32Array(sw * gh);
  for (let k = 0; k < sw * gh; k++) { const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2]; gray[k] = (r + g + b) / 3; sat[k] = Math.max(r, g, b) - Math.min(r, g, b); }
  const xs = [], ys = [];
  for (let y = y0 - gy0; y < y1 - gy0; y++) for (let x = 0; x < sw; x++) {
    const k = y * sw + x, v = gray[k]; if (v < 110 || sat[k] > 70) continue;
    const up = y >= 3 ? gray[k - 3 * sw] : v, dn = y + 3 < gh ? gray[k + 3 * sw] : v;
    if (v - Math.max(up, dn) > 18 || (v - (up + dn) / 2 > 28 && v > 150)) { xs.push(x); ys.push(y + gy0); }
  }
  if (xs.length < 25 || xs.length > sw * bh * 0.35) return null;
  const off = sw / 2 + 4, len = Math.ceil(sw + 2 * sh + 12);
  const score = (a) => {
    const sn = Math.sin(a), c = Math.cos(a), h = new Float32Array(len);
    for (let k = 0; k < xs.length; k++) { const v = Math.round(-xs[k] * sn + ys[k] * c + off); if (v >= 0 && v < len) h[v]++; }
    let sc = 0, best = 0, bi = 0; for (let k = 1; k < len - 1; k++) { sc += h[k] * h[k]; const w = h[k - 1] + h[k] + h[k + 1]; if (w > best) { best = w; bi = k; } }
    return { a, sc, best, bi };
  };
  let top = null; const deg = Math.PI / 180;
  for (let a = -20; a <= 20; a += 0.5) { const r = score(a * deg); if (!top || r.sc > top.sc) top = r; }
  for (let a = top.a / deg - 0.5; a <= top.a / deg + 0.5; a += 0.1) { const r = score(a * deg); if (r.sc > top.sc) top = r; }
  if (top.best < 0.22 * sw) return null; // keine durchgehende Linie
  const v = top.bi - off, yc = (v + (sw / 2) * Math.sin(top.a)) / Math.cos(top.a);
  return { a: top.a, y: yc / sh, conf: top.best / sw };
}
// Neigung je Bild: Ausreißer filtern, Lücken füllen, deine Korrekturen einrechnen
function laneSeries(lanes, keys) {
  const n = lanes ? lanes.length : (state.frames ? state.frames.length : 0); if (!n) return null;
  if (!lanes) lanes = new Array(n).fill(null);
  const raw = lanes.map((l) => (l ? l.a : NaN)), valid = raw.filter(Number.isFinite).length;
  let base = null;
  if (valid >= Math.max(5, 0.2 * n)) {
    const med = raw.map((v, i) => { if (!Number.isFinite(v)) return NaN; const w = []; for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6); j++) if (Number.isFinite(raw[j])) w.push(raw[j]); return median(w); });
    base = fillSeries(med);
    // leicht glätten
    base = base.map((v, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { s += base[j]; c++; } return s / c; });
  }
  const ks = (keys || []).filter((k) => k.i >= 0 && k.i < n).sort((a, b) => a.i - b.i);
  if (!ks.length) return base;
  const offAt = ks.map((k) => k.a - (base ? base[k.i] : 0));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let o;
    if (i <= ks[0].i) o = offAt[0]; else if (i >= ks[ks.length - 1].i) o = offAt[ks.length - 1];
    else { let j = 0; while (ks[j + 1].i < i) j++; const t = (i - ks[j].i) / (ks[j + 1].i - ks[j].i); o = offAt[j] + (offAt[j + 1] - offAt[j]) * t; }
    out[i] = (base ? base[i] : 0) + o;
  }
  return out;
}
function fillSeries(v) {
  const n = v.length, out = v.slice(); let last = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) {
    if (last < 0) for (let j = 0; j < i; j++) out[j] = out[i];
    else for (let j = last + 1; j < i; j++) out[j] = out[last] + (out[i] - out[last]) * (j - last) / (i - last);
    last = i;
  }
  if (last >= 0) for (let j = last + 1; j < n; j++) out[j] = out[last]; else out.fill(0);
  return out;
}
// Analyse starten – bei mitschwenkender Kamera wird jedes Bild mit seiner eigenen Bahnlinien-Neigung gerade gerückt
function runAnalyze(opts) {
  const r = runAnalyzeRaw(opts);
  // Stativ eingestellt, aber die Kamera bewegt sich (Schwenk oder Zoom): automatisch als mitschwenkend auswerten
  if (opts.camera === 'fixed' && r.camMoved && !opts.forceFixed) {
    state.analysisOpts.camera = 'pan'; state.analysisOpts.calib = null; try { segCam.set('pan'); } catch {}
    const r2 = runAnalyzeRaw({ ...opts, camera: 'pan', calib: null }); r2.autoPan = true; return r2;
  }
  return r;
}
function runAnalyzeRaw(opts) {
  const o = { ...opts }, frames = state.frames, W = state.W, H = state.H;
  const keys = (state.tiltKeys || []).slice();
  let series = null;
  // Neigung je Bild nur mit von dir gesetzter Bahnlinie – die automatisch erkannten Linien schwanken zu stark und kosten Schritte
  if (o.camera === 'pan' && keys.length) series = laneSeries(state.laneDet, keys);
  if (series) {
    const rot = frames.map((f, i) => ({ ...f, lm: f.lm ? f.lm.map((p) => { if (!p) return p; const q = rotatePt([p[0] * W, p[1] * H], series[i], W, H); return [q[0] / W, q[1] / H, p[2]]; }) : f.lm }));
    const hs = (o.hurdles || []).map((h) => { const q = rotatePt([h.x * W, h.y * H], series[h.i], W, H); return { ...h, x: q[0] / W, y: q[1] / H }; });
    const r = analyze(rot, { ...o, hurdles: hs, laneLine: null, tilt: 0, autoTilt: false });
    r.frameTilt = series; r.tiltSource = 'frames';
    r.laneHit = state.laneDet ? state.laneDet.filter(Boolean).length / state.laneDet.length : 0;
    return r;
  }
  if (false && !o.laneLine && state.laneDet) { // automatisch erkannte Bahnlinien: zu unzuverlässig (Perspektive), verfälschten die Schritterkennung
    const a = state.laneDet.filter(Boolean).map((l) => l.a);
    if (a.length >= Math.max(5, 0.2 * state.laneDet.length)) { const t = median(a); if (Math.abs(t) > 0.003) { o.tilt = t; o.autoTilt = false; const r = analyze(frames, o); r.tiltSource = 'lanes'; return r; } }
  }
  return analyze(frames, o);
}
// Bildpunkt aus Analyse-Koordinaten zurück ins Video (berücksichtigt Neigung je Bild)
function unrot(p, i, r = state.result) {
  if (!p) return p; let q = rotatePt(p, r.tilt, state.W, state.H, true);
  if (r.zoomK && Number.isFinite(r.zoomK[i])) q = [state.W / 2 + (q[0] - state.W / 2) / r.zoomK[i], state.H / 2 + (q[1] - state.H / 2) / r.zoomK[i]];
  if (r.frameTilt && Number.isFinite(r.frameTilt[i])) q = rotatePt(q, r.frameTilt[i], state.W, state.H, true);
  return q;
}
// Bahnlinie in Bild i (normiert, zwei Punkte) – für die Anzeige
function laneLineAt(i) {
  const r = state.result; if (!r || !r.frameTilt) return null;
  const a = r.frameTilt[i]; let y = NaN;
  const key = (state.tiltKeys || []).find((k) => k.i === i); if (key) y = key.y;
  if (!Number.isFinite(y) && state.laneDet) { for (let d = 0; d < 30 && !Number.isFinite(y); d++) { const l = state.laneDet[i - d] || state.laneDet[i + d]; if (l) y = l.y; } }
  let cx = 0.5;
  if (!key) { // durch den tiefsten Fuß legen, damit die Linie unter dir liegt
    const lm = state.frames[i] && state.frames[i].lm;
    if (lm) { const f = [29, 30, 31, 32].map((j) => lm[j]).filter((q) => q && q[2] > 0.3).sort((p1, p2) => p2[1] - p1[1])[0]; if (f) { cx = f[0]; y = f[1] + 0.01; } }
  }
  if (!Number.isFinite(y)) y = 0.9;
  const t = Math.tan(a) * state.W / state.H, x1 = Math.max(0.05, cx - 0.3), x2 = Math.min(0.95, cx + 0.3);
  return [{ x: x1, y: y + (x1 - cx) * t }, { x: x2, y: y + (x2 - cx) * t }];
}

async function detectFrames(lmk, i0, n, fileFps, target, ctx, canvas, prog, targetT) {
  const frames = new Array(n).fill(null).map(() => ({ lm: null })), times = new Array(n), lanes = new Array(n).fill(null);
  for (let k = 0; k < n; k++) times[k] = Math.min(state.duration - 0.001, (i0 + k + 0.5) / fileFps);
  const W = state.W, H = state.H;
  const crop = document.createElement('canvas'), cctx = crop.getContext('2d');
  // Zweiter Versuch mit aufgehelltem Bild: dunkle Schuhe vor dunklem Hintergrund (z. B. schwarze Matte) hebt eine Tonwertkurve voneinander ab
  const crop2 = document.createElement('canvas'), cctx2 = crop2.getContext('2d', { willReadFrequently: true });
  const enh = { tried: 0, used: 0 }; state.enh = enh;
  const brighten = (src) => {
    crop2.width = src.width; crop2.height = src.height; cctx2.drawImage(src, 0, 0);
    const img = cctx2.getImageData(0, 0, crop2.width, crop2.height), d = img.data, w = img.width, h = img.height, hist = new Uint32Array(256), histAll = new Uint32Array(256); let cnt = 0, cntAll = 0;
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { const o = (y * w + x) * 4, l = (d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8; histAll[l]++; cntAll++; if (y >= h * 0.5) { hist[l]++; cnt++; } }
    const q = (hs, c, p) => { let a = 0; for (let i = 0; i < 256; i++) { a += hs[i]; if (a >= p * c) return i; } return 255; };
    // Schwarz- und Weißpunkt aus dem ganzen Bild (der Oberkörper bleibt erkennbar), die Aufhellung richtet sich nach der unteren Hälfte (Füße)
    const lo = q(histAll, cntAll, 0.01), hi = Math.max(lo + 40, q(histAll, cntAll, 0.995)), dark = Math.max(0.02, Math.min(0.9, (q(hist, cnt, 0.35) - lo) / (hi - lo)));
    const g = Math.max(0.4, Math.min(1, Math.log(0.42) / Math.log(dark))); // hebt die dunklen Töne an, ohne die hellen auszufressen
    const lut = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(Math.max(0, Math.min(1, (i - lo) / (hi - lo))), g);
    for (let o = 0; o < d.length; o += 4) { d[o] = lut[d[o]]; d[o + 1] = lut[d[o + 1]]; d[o + 2] = lut[d[o + 2]]; }
    cctx2.putImageData(img, 0, 0); return crop2;
  };
  const footVis = (p) => { const m = (ks) => ks.reduce((t, j) => t + (p[j] ? (p[j].visibility ?? 1) : 0), 0) / ks.length; return Math.min(m([27, 29, 31]), m([28, 30, 32])); };
  // Region um eine Stelle (normiert), quadratisch in Pixeln, ins Bild geschoben
  const regionAt = (cx, cy, sidePx) => {
    const side = Math.min(sidePx, W, H); let x0 = cx * W - side / 2, y0 = cy * H - side / 2;
    x0 = Math.max(0, Math.min(W - side, x0)); y0 = Math.max(0, Math.min(H - side, y0));
    return { x0: x0 / W, y0: y0 / H, w: side / W, h: side / H };
  };
  const detect = (region, bright) => {
    state.tsBase += 1;
    try {
      if (!region) { const r = lmk.detectForVideo(video, state.tsBase); return (r && r.landmarks) || []; }
      const sx = region.x0 * W, sy = region.y0 * H, sw = region.w * W, sh = region.h * H, sc = 640 / Math.max(sw, sh);
      crop.width = Math.round(sw * sc); crop.height = Math.round(sh * sc);
      cctx.drawImage(video, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
      const r = lmk.detectForVideo(bright ? brighten(crop) : crop, state.tsBase);
      return ((r && r.landmarks) || []).map((pose) => pose.map((p) => ({ x: region.x0 + p.x * region.w, y: region.y0 + p.y * region.h, z: p.z, visibility: p.visibility })));
    } catch { return []; }
  };
  const findPose = (prev, tgt) => {
    if (prev) {
      const b = bbox(prev);
      if (b.h < 0.85) { // Ausschnitt um die Person: das Modell sieht sie groß und setzt Füße und Knie genauer
        const side = Math.max(b.h * H, (b.x1 - b.x0) * W) * 1.8;
        const lostN = (prev._lost || 0) + 1;
        const reg = regionAt(Math.max(0, Math.min(1, b.cx + (prev._vx || 0) * lostN)), Math.max(0, Math.min(1, b.cy + (prev._vy || 0) * lostN)), Math.max(side, 0.2 * H) * (1 + 0.15 * Math.min(4, lostN - 1))); let pr = pickPose(detect(reg), prev, null);
        // Füße unsicher oder Person verloren: noch einmal mit aufgehelltem Bild. Bringt das über viele Bilder nichts, wird es gelassen.
        if ((!pr || footVis(pr) < 0.5) && !(enh.tried > 40 && enh.used < 0.1 * enh.tried)) {
          enh.tried++; const p2 = pickPose(detect(reg, true), prev, null);
          if (p2 && (!pr || footVis(p2) > footVis(pr) + 0.04)) { pr = p2; enh.used++; }
        }
        if (pr) return pr;
      }
      return pickPose(detect(null), prev, null);
    }
    let pz = pickPose(detect(null), null, tgt); if (pz || !tgt) return pz;
    for (const f of [0.5, 0.3, 0.8]) { pz = pickPose(detect(regionAt(tgt.x, tgt.y, f * H)), null, tgt); if (pz) return pz; }
    return null;
  };
  // Beim angetippten Bild anfangen, dann vorwärts und rückwärts verfolgen
  let kT = 0;
  if (target && targetT != null) kT = Math.max(0, Math.min(n - 1, Math.round(targetT * fileFps) - i0));
  const order = []; for (let k = kT; k < n; k++) order.push(k); for (let k = kT - 1; k >= 0; k--) order.push(k);
  state.tsBase = (state.tsBase || 0) + 1e6;
  let prev = null, anchor = null, done = 0; const t0 = performance.now();
  for (const k of order) {
    if (state.cancel) break;
    if (k === kT - 1) { prev = anchor; if (prev) { prev._vx = 0; prev._vy = 0; prev._lost = 0; } state.tsBase += 1e5; } // Rückwärts-Durchgang startet bei der angetippten Person
    await seekTo(times[k]);
    let pose = findPose(prev, prev ? null : target);
    if (!pose && prev && !target && done < 3) pose = findPose(null, null);
    if (pose) {
      if (prev && prev !== pose) { const a = bbox(prev), b = bbox(pose), g = (prev._lost || 0) + 1; pose._vx = 0.6 * (prev._vx || 0) + 0.4 * (b.cx - a.cx) / g; pose._vy = 0.6 * (prev._vy || 0) + 0.4 * (b.cy - a.cy) / g; }
      pose._lost = 0; prev = pose; if (!anchor && k >= kT) anchor = pose;
    } else if (prev) prev._lost = (prev._lost || 0) + 1;
    const lm = pose ? pose.map((p) => [p.x, p.y, p.visibility ?? 1]) : null;
    frames[k] = { lm }; done++;
    { let fy = NaN; if (lm) { const ys = [29, 30, 31, 32].map((j) => lm[j]).filter((q) => q && q[2] > 0.3).map((q) => q[1]); if (ys.length) fy = Math.max(...ys); } lanes[k] = detectLane(fy); }
    if (ctx && (done % 3 === 0 || done === n)) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height); drawPose(ctx, lm, canvas.width, canvas.height);
      if (target && !prev) { ctx.fillStyle = '#C2362B'; ctx.beginPath(); ctx.arc(target.x * canvas.width, target.y * canvas.height, 10, 0, 7); ctx.fill(); }
    }
    if (done % 3 === 0 || done === n) { const el = (performance.now() - t0) / 1000, rest = el / done * (n - done); prog(`Bild ${done} von ${n}, noch etwa ${Math.ceil(rest)} s`, done / n); await sleep(0); }
  }
  return { frames, times, lanes };
}

// ======================= Analyse starten =======================
$('cancelBtn').onclick = () => { state.cancel = true; };
function setProgress(t, p) { $('progText').textContent = t; if (p != null) { $('progRing').style.strokeDashoffset = String(327 * (1 - p)); $('progPct').textContent = Math.round(p * 100) + ' %'; } }
async function runAnalysis() {
  const fileFps = state.fileFps || 30;
  const i0 = Math.round(state.start * fileFps), i1 = Math.round(state.end * fileFps) - 1, n = i1 - i0 + 1;
  if (n > 6000) { setStep(1); toast('Der Ausschnitt hat mehr als 6000 Bilder. Bitte mit den gelben Griffen kürzen.'); return; }
  if (n < 10) { setStep(1); toast('Der Ausschnitt ist zu kurz.'); return; }
  const height = parseNum($('height').value) || 180; saveProfile({ heightCm: height });
  video.pause(); state.cancel = false; $('setupMsg').innerHTML = '';
  showScreen('s-progress'); setProgress('Lade Erkennungsmodell (einmalig ca. 25 MB)', 0);
  const canvas = $('procCanvas'), scale = Math.min(1, 960 / state.W); canvas.width = Math.round(state.W * scale); canvas.height = Math.round(state.H * scale);
  let lmk;
  try { lmk = await getLandmarker((t) => setProgress(t)); }
  catch (e) { showScreen('s-setup'); $('setupMsg').innerHTML = `<div class="notice err">Das Erkennungsmodell konnte nicht geladen werden (${esc(e.message || e)}). Seite neu laden oder Chrome/Safari verwenden.</div>`; return; }
  const { frames, times, lanes } = await detectFrames(lmk, i0, n, fileFps, state.personPt, canvas.getContext('2d'), canvas, setProgress, state.personT);
  state.laneDet = lanes;
  state.tiltKeys = (state.camera === 'pan' && state.lane.length === 2 && state.markT != null) ? [{ i: Math.max(0, Math.min(n - 1, Math.round(state.markT * fileFps) - i0)), a: laneTilt() * Math.PI / 180, y: (state.lane[0].y + state.lane[1].y) / 2 }] : [];
  if (state.cancel) { showScreen('s-setup'); return; }
  const fps = parseNum($('fps').value) || fileFps;
  state.lane = []; state.calib = []; state.markT = null;
  const laneLine = state.lane.length === 2 ? { x1: state.lane[0].x, y1: state.lane[0].y, x2: state.lane[1].x, y2: state.lane[1].y } : null;
  const cm = parseNum($('calibM').value);
  const calib = state.calib.length === 2 && cm > 0 && state.camera === 'fixed' ? { x1: state.calib[0].x, y1: state.calib[0].y, x2: state.calib[1].x, y2: state.calib[1].y, meters: cm } : null;
  Object.assign(state, { frames, frameTimes: times, i0Frame: i0, analysisOpts: { fps, W: state.W, H: state.H, heightCm: height, camera: state.camera, mode: state.mode, laneLine, calib, hurdle: null, hurdles: state.mode === 'hurdle' ? state.hurdles.map((h) => ({ nr: h.nr, x: h.x, y: h.y, i: Math.max(0, Math.min(n - 1, Math.round(h.t * fileFps) - i0)) })) : [] } });
  state.hSel = 'all';
  state.manualGL = null; ed.undo = []; ed.sel = null; ed.frame = 0;
  setProgress('Werte berechnen …', 1); await sleep(40);
  try { state.result = runAnalyze(state.analysisOpts); }
  catch (e) { showScreen('s-setup'); toast('Auswertung fehlgeschlagen: ' + (e.message || e)); return; }
  await autoTune();
  if (state.result && state.enh) state.result._enh = { ...state.enh, n };
  setProgress('Ergebnis aufbauen …', 1); await sleep(40);
  state.fromAnalysis = true;
  finishResult(state.phase === 'auto');
}
// Automatik nach der Analyse: eine unmögliche Bildrate korrigieren und Hürden von selbst erkennen
async function autoTune() {
  const o = state.analysisOpts, notes = [];
  try {
    const cad = summarize(state.result).cadenceHz;
    if (Number.isFinite(cad) && cad > 5.8) { setProgress('Bildrate prüfen …', 1); await sleep(40); // mehr als 5,8 Schritte pro Sekunde schafft niemand: die Bildrate ist zu hoch gewählt
      const f2 = [...new Set([state.fileFps, 30, 60, 120, 240])].filter((f) => f < o.fps).map((f) => ({ f, c: cad * f / o.fps })).filter((x) => x.c >= 3 && x.c <= 5.4).sort((a, b) => Math.abs(a.c - 4.3) - Math.abs(b.c - 4.3))[0];
      if (f2) { const old = o.fps; o.fps = f2.f; state.result = runAnalyze(o); notes.push({ kind: 'fps', old, now: f2.f, cad }); try { $('fps').value = String(f2.f); } catch {} }
    }
    // Hürdensuche nur, wenn es überhaupt eine lange Flugphase gibt (spart auf dem Handy eine ganze Auswertung)
    const cs = (state.result.contacts || []).slice().sort((a, b) => a.i0 - b.i0);
    const longFlight = cs.some((c, k) => k > 0 && (c.i0 - cs[k - 1].i1) / o.fps * 1000 > 230);
    if (o.mode === 'sprint' && longFlight) {
      setProgress('Hürden suchen …', 1); await sleep(40);
      const r2 = runAnalyze({ ...o, mode: 'hurdle', hurdles: [] });
      const hs = (r2.hurdles || []).filter((h) => h.found && h.flightMs >= 260 && h.hipRiseCm >= 10);
      if (hs.length) { o.mode = 'hurdle'; o.hurdles = []; state.result = r2; notes.push({ kind: 'hurdle', n: hs.length }); }
    }
  } catch (e) { console.warn('autoTune', e); }
  state.result._auto = notes;
}
const slowK = () => Math.max(1, ((state.analysisOpts && state.analysisOpts.fps) || parseNum($('fps').value) || state.fileFps || 30) / (state.fileFps || 30));
// Abspieltempo bezogen auf die echte Geschwindigkeit (1 = so schnell wie in Wirklichkeit, auch bei Zeitlupen-Videos)
function setRate(real) { const want = Math.max(0.0625, Math.min(16, real * slowK())); for (const v of [want, Math.min(want, 8), Math.min(want, 4), Math.min(want, 2), 1]) { try { video.playbackRate = v; if (Math.abs(video.playbackRate - v) < 0.01) return; } catch {} } }
// Mehrere Läufer aus demselben Video: jeder wird einzeln verfolgt und ausgewertet, im Ergebnis schaltet man um
const RK = ['frames', 'frameTimes', 'i0Frame', 'analysisOpts', 'result', 'laneDet', 'tiltKeys', 'manualGL', 'hSel', 'resPhase', 'phaseAuto', 'savedId', 'dirty', 'marks', 'markPos', 'rx', 'personPt', 'personT', 'personPose'];
const snapRunner = () => Object.fromEntries(RK.map((k) => [k, state[k]]));
function keepRunner() { if (state.runners && state.runners.length) state.runners[state.runnerIdx || 0] = snapRunner(); }
function switchRunner(k) {
  if (!state.runners || k === state.runnerIdx || !state.runners[k]) return;
  vcStop(); keepRunner(); Object.assign(state, state.runners[k]); state.runnerIdx = k;
  ed.undo = []; ed.sel = null; ed.frame = 0; vc.metric = null; vc.keepFrame = null; if (vc.markArm) setMarkArm(false);
  resTabs.set('overview'); showPane('overview'); renderResult(); toast(`Läufer ${k + 1}`);
}
function renderRunners() {
  const el = $('runnerSel'), rs = state.runners || [], can = !!(state.file && state.frames && video.src);
  el.hidden = !can && rs.length < 2; if (el.hidden) { $('runnerCmp').innerHTML = ''; return; }
  el.innerHTML = (rs.length > 1 ? rs.map((_, k) => `<button class="chip ${k === state.runnerIdx ? 'on' : ''}" data-runner="${k}">Läufer ${k + 1}</button>`).join('') : '') + (can && rs.length < 6 ? '<button class="chip" data-runner="add">+ Weiteren Läufer auswerten</button>' : '');
  if (rs.length < 2) { $('runnerCmp').innerHTML = ''; return; }
  const sums = rs.map((x, k) => summarize(k === state.runnerIdx ? state.result : x.result)), rows = [['contactMs', 'Bodenkontakt'], ['flightMs', 'Flugzeit'], ['cadenceHz', 'Schritte pro s'], ['kneeLiftDeg', 'Kniehub'], ['trunkDeg', 'Rumpf']];
  const best = (key, vals) => { const f = vals.filter(Number.isFinite); if (f.length < 2) return NaN; return key === 'contactMs' ? Math.min(...f) : key === 'cadenceHz' || key === 'kneeLiftDeg' ? Math.max(...f) : NaN; };
  $('runnerCmp').innerHTML = `<div class="card" style="padding:12px 14px"><div class="tablewrap"><table><thead><tr><th></th>${rs.map((_, k) => `<th>Läufer ${k + 1}</th>`).join('')}</tr></thead><tbody>${rows.map(([key, lab]) => { const m = M(key), vals = sums.map((q) => q[key]), b = best(key, vals); return vals.some(Number.isFinite) ? `<tr><td>${lab}</td>${vals.map((v) => `<td class="num" style="${v === b ? 'color:var(--good);font-weight:700' : ''}">${Number.isFinite(v) ? fmt(v, m.digits) + ' ' + esc(m.unit) : '–'}</td>`).join('')}</tr>` : ''; }).join('')}</tbody></table></div></div>`;
}
$('runnerSel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-runner]'); if (!b) return;
  if (b.dataset.runner !== 'add') return switchRunner(+b.dataset.runner);
  vcStop(); keepRunner(); state.addRunner = true;
  Object.assign(state, { personPt: null, personT: null, personPose: null });
  showScreen('s-setup'); setStep(3); setTap('person'); drawSetupOverlay(); fsRender();
  toast('Spule zu einem Bild mit dem nächsten Läufer und tippe ihn an');
});
function finishResult(auto) {
  if (state.fromAnalysis) { if (state.addRunner && state.runners && state.runners.length) { state.runnerIdx = state.runners.length; state.runners.push(null); } else { state.runners = [null]; state.runnerIdx = 0; } }
  else { state.runners = [null]; state.runnerIdx = 0; }
  state.fromAnalysis = false; state.addRunner = false;
  const sum = summarize(state.result);
  state.result.stride = extractStride(state.result); if (state.result.stride) state.result.stride.speed = sum.speedMs || null;
  state.phaseAuto = auto; state.resPhase = auto ? suggestPhase(sum) : (state.phase === 'auto' ? suggestPhase(sum) : state.phase);
  state.savedId = null; state.dirty = false; state.marks = []; state.markPos = {}; state.rx = null; vc.metric = null; if (vc.markArm) setMarkArm(false); Object.assign(kino, { step: null, hurdle: null, off: [0, 0, 0, 0, 0], mode: 'run' });
  showScreen('s-result'); resTabs.set('overview'); showPane('overview'); renderResult();
}

// ======================= Ergebnis =======================
// Ergebnis-Navigation: vier Bereiche, darunter bei Bedarf die Unterseiten
const RES_GROUPS = {
  overview: { label: 'Überblick', panes: [['overview', 'Überblick']] },
  video: { label: 'Im Video', panes: [['check', 'Werte prüfen'], ['edit', 'Schritte korrigieren']] },
  numbers: { label: 'Zahlen', panes: [['areas', 'Bereiche'], ['curves', 'Verlauf'], ['steps', 'Tabelle']] },
  pics: { label: 'Bilder', panes: [['kino', 'Kinogramm']] },
};
const RES_INFO = {
  overview: 'Das Wichtigste aus deinem Lauf in Kürze.',
  check: 'Wähle einen Wert und einen Schritt – du siehst das Bild, in dem gemessen wurde.',
  edit: 'Fehlt ein Schritt oder ist einer falsch? Hier korrigierst du die Bodenkontakte.',
  areas: 'Alle Werte nach Körperbereich, mit Richtbereich und Tipp.',
  curves: 'Tempo, Kraft und links gegen rechts über den Lauf.',
  steps: 'Jeder Schritt einzeln. Haken weg nimmt einen falschen Schritt aus der Wertung.',
  kino: '', figure: '',
};
const groupOf = (pane) => Object.keys(RES_GROUPS).find((g) => RES_GROUPS[g].panes.some(([p]) => p === pane)) || 'overview';
const resTabs = (() => {
  const main = $('resMain'), sub = $('resSub'), info = $('resInfo');
  let cur = 'overview';
  const paint = () => {
    const g = groupOf(cur), gi = Object.keys(RES_GROUPS).indexOf(g);
    main.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === g)); main.style.setProperty('--i', gi);
    const ps = RES_GROUPS[g].panes; sub.hidden = ps.length < 2;
    sub.innerHTML = ps.map(([p, l]) => `<button data-v="${p}" class="${p === cur ? 'on' : ''}">${l}</button>`).join('');
    sub.style.setProperty('--n', ps.length); sub.style.setProperty('--i', Math.max(0, ps.findIndex(([p]) => p === cur)));
    info.textContent = RES_INFO[cur] || ''; info.hidden = !RES_INFO[cur];
  };
  main.style.setProperty('--n', Object.keys(RES_GROUPS).length);
  main.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; cur = RES_GROUPS[b.dataset.v].panes[0][0]; paint(); showPane(cur); });
  sub.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; cur = b.dataset.v; paint(); showPane(cur); });
  return { set(v) { cur = v; paint(); } };
})();
const resPhaseSeg = initSeg($('resPhase'), (v) => { state.resPhase = v; state.phaseAuto = false; state.dirty = true; renderResult(); });
function showPane(v) {
  clearFocus();
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'p-' + v));
  if (v === 'check') { setupVC(); }
  if (v === 'edit') setupEdit(); else edStop();
  if (v === 'figure') setupFigure(); else if (player) player.pause();
  if (v === 'curves') renderCurves();
  if (v === 'kino') setupKino();
  if (v !== 'check') vcStop();
}
const sumNow = () => summarize(state.result);
$('resNotices').addEventListener('click', (e) => {
  const a = e.target.closest('[data-refps]'), b = e.target.closest('[data-remode]');
  if (a) { e.preventDefault(); const f = +a.dataset.refps; try { $('fps').value = String(f); } catch {} edRecompute({ fps: f }, `Mit ${f} fps neu berechnet`, null); }
  if (b) { e.preventDefault(); edRecompute({ mode: b.dataset.remode, hurdles: [] }, 'Als Sprint ausgewertet', null); }
});
function renderResult() {
  const r = state.result, sum = sumNow(), phase = state.resPhase, o = state.analysisOpts;
  resPhaseSeg.set(phase);
  $('openSave').textContent = state.savedId ? (state.dirty ? 'Änderungen speichern' : 'Gespeichert ✓') : 'Speichern';
  $('phaseNoteWrap').textContent = `(jetzt: ${phaseName(phase)}${state.phaseAuto ? ', automatisch erkannt' : ''})`;
  const tiltTxt = r.tiltSource === 'frames' ? `Neigung je Bild über die Bahnlinien ausgeglichen (Linie in ${fmt((r.laneHit || 0) * 100)} % der Bilder gefunden)` : r.tiltSource === 'lanes' ? `Neigung ${fmt(r.tilt * 180 / Math.PI, 1)}° über erkannte Bahnlinien ausgeglichen` : r.tiltSource === 'lane' ? `Neigung ${fmt(r.tilt * 180 / Math.PI, 1)}° per Bahnlinie ausgeglichen` : r.tiltSource === 'auto' ? `Neigung ${fmt(r.tilt * 180 / Math.PI, 1)}° automatisch ausgeglichen` : '';
  $('resMeta').textContent = [state.file && state.file.name, `${sum.steps} Schritte`, `${o.fps} fps`, tiltTxt, r.scaleSource === 'calib' ? 'Längen über Markierungen' : ''].filter(Boolean).join(', ');
  // Hinweise zur Qualität
  const notes = [];
  if (r.quality.detectedPct < 80) notes.push(['warn', `Du wurdest nur in ${fmt(r.quality.detectedPct)} % der Bilder erkannt. Ganzer Körper im Bild und mehr Licht machen die Werte sicherer.`]);
  if (sum.steps < 2) notes.push(['warn', 'Zu wenige vollständige Schritte. Ausschnitt verlängern oder prüfen, ob die Füße immer im Bild sind.']);
  if (o.fps < 100) notes.push(['', `Bei ${o.fps} fps liegen nur wenige Bilder im Bodenkontakt. Kontaktzeiten sind auf etwa ±${fmt(Math.max(5, 400 / o.fps))} ms genau – für genaue Werte in Zeitlupe filmen.`]);
  if (r.edited) notes.push(['', 'Du hast Bodenkontakte von Hand korrigiert – alle Werte sind mit deinen Korrekturen berechnet.']);
  if (r.recoveredCount) notes.push(['', `${r.recoveredCount} Schritt(e) wurden über den Laufrhythmus ergänzt, weil die Erkennung sie zunächst übersehen hatte. Sie sind unter „Schritte“ markiert – im Video-Check prüfen.`]);
  if (r.obliqueShare > 0.25) notes.push(['warn', r.obliqueShare > 0.7 ? 'Du läufst meist schräg zur Kamera. Zeiten stimmen, Winkel lassen sich so kaum messen – für Technikwerte genau von der Seite filmen.' : `${Math.round(r.obliqueShare * 100)} % der Schritte sind schräg zur Kamera gefilmt. Für Winkel zählen nur die seitlichen Schritte, Zeiten zählen alle.`]);
  if (r.autoPan) notes.push(['', `Die Kamera hat sich bewegt${r.zoomK ? ' und gezoomt' : ''} – das ist automatisch berücksichtigt.`]);
  else if (r.zoomK) notes.push(['', 'Die Kamera hat gezoomt – das ist automatisch berücksichtigt.']);
  if (o.mode === 'hurdle' && r.steps.some((s) => s.hurdleStep)) notes.push(['', 'Absprung- und Landeschritte an den Hürden sind aus den Laufwerten (Kontaktzeit, Flugzeit, links/rechts …) herausgenommen und stehen gesondert unter „Hürden“. So verfälscht die lange Flugphase über der Hürde nicht den Vergleich der Beine.']);
  if (o.camera === 'fixed' && Number.isFinite(sum.speedMs) && sum.speedMs > 12.5) notes.push(['warn', `Das berechnete Tempo (${fmt(sum.speedMs, 1)} m/s) ist nicht möglich und wird ausgeblendet. Prüfe Bildrate und Körpergröße, oder miss mit der Stoppuhr unter „Im Video“.`]);
  if (r._enh && r._enh.tried > 0.12 * r._enh.n) notes.push(['warn', `In ${Math.round(100 * r._enh.tried / r._enh.n)} % der Bilder waren die Füße schwer zu erkennen, meist wegen dunklem Hintergrund oder dunklen Schuhen. ${r._enh.used ? `Bei ${r._enh.used} Bildern hat Aufhellen geholfen. ` : ''}Prüfe die Kontakte unter „Im Video“.`]);
  const fl = r.steps.filter((s) => s.flags && s.flags.length && !s.partial);
  if (fl.length) notes.push(['warn', `${fl.length} Schritt(e) sehen unplausibel aus und sollten im Video-Check geprüft werden.`]);
  const noteHtml = ([c, t, act]) => `<div class="notice ${c}">${esc(t)}${act === 'camfix' ? ' <a href="#" id="camFix"><b>Auf „schwenkt mit“ umstellen ›</b></a>' : ''}</div>`;
  const warnN = notes.filter((x) => x[0] === 'warn'), infoN = notes.filter((x) => x[0] !== 'warn');
  const autoHtml = (r._auto || []).map((a) => a.kind === 'fps' ? `<div class="notice">Bildrate automatisch auf <b>${a.now} fps</b> gestellt. Mit ${a.old} fps wären es ${fmt(a.cad, 1)} Schritte pro Sekunde, das schafft niemand. <a href="#" data-refps="${a.old}"><b>Zurück auf ${a.old} ›</b></a></div>` : a.kind === 'hurdle' ? `<div class="notice">${a.n === 1 ? 'Eine Hürde' : a.n + ' Hürden'} erkannt und als Hürdenlauf ausgewertet. <a href="#" data-remode="sprint"><b>Als Sprint auswerten ›</b></a></div>` : '').join('')
    + (Number.isFinite(sum.cadenceHz) && sum.cadenceHz < 2.4 && o.fps <= 60 ? `<div class="notice warn">Nur ${fmt(sum.cadenceHz, 1)} Schritte pro Sekunde. In Zeitlupe gefilmt? <a href="#" data-refps="120"><b>120 fps</b></a> · <a href="#" data-refps="240"><b>240 fps</b></a></div>` : '');
  $('resNotices').innerHTML = autoHtml + (warnN.length > 1 ? `<div class="notice warn"><b>Zur Aufnahme</b><ul style="margin:6px 0 0;padding-left:18px">${warnN.map(([, t]) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : warnN.map(noteHtml).join('')) + (infoN.length ? `<details class="more"><summary>Hinweise zur Auswertung (${infoN.length})</summary>${infoN.map(noteHtml).join('')}</details>` : '') + '<p class="hint small" style="margin:6px 2px 12px">Fehlt ein Schritt? <a href="#" id="goEdit"><b>Selbst korrigieren ›</b></a></p>';
  const cf = $('camFix'); if (cf) cf.onclick = (e) => { e.preventDefault(); edRecompute({ camera: 'pan' }, 'Auf „schwenkt mit“ umgestellt'); };
  const ge = $('goEdit'); if (ge) ge.onclick = (e) => { e.preventDefault(); resTabs.set('edit'); showPane('edit'); };
  renderRunners();
  renderOverview(sum, phase); renderAreas(sum, phase); renderSteps();
  if ($('p-check').classList.contains('on')) setupVC();
  if ($('p-edit').classList.contains('on')) setupEdit();
}

// ---------- Überblick ----------
function areaStats(cat, sum, phase) {
  const ev = cat.keys.map((k) => evaluate(k, sum[k], phase)).filter((e) => e.status !== 'none');
  const good = ev.filter((e) => e.status === 'good').length;
  const status = !ev.length ? 'none' : ev.some((e) => e.status === 'off') ? 'off' : ev.some((e) => e.status === 'near') ? 'near' : 'good';
  return { n: ev.length, good, status };
}
const COL = { good: 'var(--good)', near: 'var(--near)', off: 'var(--off)', none: 'var(--muted)' };
function renderOverview(sum, phase) {
  const cats = CATEGORIES.filter((c) => c.keys.some((k) => Number.isFinite(sum[k])));
  $('ringTiles').innerHTML = cats.length ? cats.map((c) => {
    const st = areaStats(c, sum, phase), frac = st.n ? st.good / st.n : 0, L = 2 * Math.PI * 26;
    return `<button class="ringtile" data-area="${c.id}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" stroke="var(--card2)" stroke-width="8" fill="none"/><circle cx="32" cy="32" r="26" stroke="${COL[st.status]}" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - Math.max(frac, st.n ? 0.04 : 0))}"/></svg>
      <span><span class="nm">${esc(c.label)}</span><br><span class="st">${st.n ? `${st.good} von ${st.n} im Richtbereich` : 'zum Vergleichen'}</span></span></button>`;
  }).join('') : '<div class="empty"><b>Keine Schritte erkannt</b>Prüfe den Ausschnitt: Läufst du mit mindestens 2–3 ganzen Schritten durchs Bild?</div>';
  $('ringTiles').onclick = (e) => { const b = e.target.closest('[data-area]'); if (!b) return; resTabs.set('areas'); showPane('areas'); const el = document.getElementById('area-' + b.dataset.area); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // Wichtigste Abweichungen
  const items = Object.keys(REF[phase] || {}).map((k) => ({ k, e: evaluate(k, sum[k], phase) })).filter((x) => x.e.status === 'off' || x.e.status === 'near')
    .map((x) => ({ ...x, dev: Math.abs((x.e.side === 'low' ? x.e.ref.lo - sum[x.k] : sum[x.k] - x.e.ref.hi) / (x.e.ref.hi - x.e.ref.lo)) }))
    .sort((a, b) => (a.e.status === b.e.status ? b.dev - a.dev : a.e.status === 'off' ? -1 : 1)).slice(0, 3);
  renderSummary(sum, phase, items, cats);
  $('findings').innerHTML = items.length ? items.map(({ k, e }) => {
    const m = M(k);
    return `<div class="finding"><div class="bar" style="background:${COL[e.status]}"></div><div>
      <div class="t">${esc(shortLabel(k))}: <span class="v">${fmt(sum[k], m.digits)} ${esc(m.unit)}</span> <span class="hint small">Richtwert ${e.ref.lo}–${e.ref.hi}</span></div>
      ${e.ref[e.side] ? `<div class="tip">${esc(e.ref[e.side])}</div>` : '<div style="height:6px"></div>'}
      <button class="btn tint sm" data-show="${k}">Im Video zeigen</button></div></div>`;
  }).join('') : `<div class="finding"><div class="bar" style="background:var(--good)"></div><div><div class="t">Alles mit Richtwert liegt im grünen Bereich.</div><div class="tip">Vergleiche trotzdem deine Läufe untereinander – dort siehst du Fortschritte am besten.</div></div></div>`;
  $('findings').onclick = (e) => { const b = e.target.closest('[data-show]'); if (b) openCheck(b.dataset.show); };
  const fixed = state.analysisOpts.camera === 'fixed';
  const spOk = !(Number.isFinite(sum.speedMs) && (sum.speedMs > 12.5 || sum.speedMs < 0.5));
  const keys = ['contactMs', 'flightMs', 'cadenceHz'].concat(fixed && !state.result.zoomK && spOk ? ['stepLenM', 'speedMs'] : []);
  $('keyNums').innerHTML = keys.map((k) => { const m = M(k), e = evaluate(k, sum[k], phase); return `<div class="key"><div class="l">${esc(shortLabel(k))}</div><div class="v ${e.status !== 'none' ? 't-' + e.status : ''}">${fmt(sum[k], m.digits)}<small>${esc(m.unit)}</small></div></div>`; }).join('');
  // Großer Wert oben + drei Kacheln
  const heroK = keys.includes('speedMs') && Number.isFinite(sum.speedMs) ? 'speedMs' : 'contactMs';
  const hm = M(heroK), he = evaluate(heroK, sum[heroK], phase);
  const curLabel = (store.runs.find((x) => x.id === state.savedId) || {}).label;
  const prev = store.runs.filter((x) => x.id !== state.savedId && curLabel && x.label === curLabel && x.summary && Number.isFinite(x.summary[heroK])).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  const d = prev ? sum[heroK] - prev.summary[heroK] : null, better = d != null && (heroK === 'speedMs' ? d > 0 : d < 0);
  $('resHero').innerHTML = Number.isFinite(sum[heroK]) ? `<div class="l">${esc(shortLabel(heroK))}</div><div class="row1"><span class="v">${fmt(sum[heroK], hm.digits)}</span><span class="u">${esc(hm.unit)}</span>${d != null && Math.abs(d) > 1e-9 ? `<span class="badge2" style="background:color-mix(in srgb, ${better ? 'var(--good)' : 'var(--off)'} 14%, transparent);color:${better ? 'var(--good)' : 'var(--off)'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d), hm.digits)} zum letzten</span>` : he.status !== 'none' ? `<span class="badge2" style="background:color-mix(in srgb, ${COL[he.status]} 14%, transparent);color:${COL[he.status]}">${he.status === 'good' ? 'im Richtbereich' : he.status === 'near' ? 'knapp daneben' : 'deutlich daneben'}</span>` : ''}</div>` : '';
  const kk = ['contactMs', 'stepLenM', 'cadenceHz', 'flightMs'].filter((k) => k !== heroK && Number.isFinite(sum[k]) && (k !== 'stepLenM' || keys.includes('stepLenM'))).slice(0, 3);
  $('resKpis').innerHTML = kk.map((k) => { const m = M(k), e = evaluate(k, sum[k], phase); return `<div class="k"><span class="l">${esc(shortLabel(k))}</span><span class="v">${fmt(sum[k], m.digits)}<small>${esc(m.unit)}</small></span><span class="bar" style="background:${COL[e.status]};opacity:${e.status === 'none' ? .35 : 1}"></span></div>`; }).join('');
  const r = state.result, hb = state.analysisOpts.mode === 'hurdle';
  $('hurdleBlock').hidden = !hb;
  if (hb) renderHurdleBlock(sum);
}
function renderHurdleBlock(sum) {
  const r = state.result, hs = r.hurdles || (r.hurdle ? [r.hurdle] : []), found = hs.filter((h) => h.found);
  if (!hs.length) { $('hurdleSel').innerHTML = ''; $('hurdleInfo').innerHTML = '<p class="hint">Keine Hürdenüberquerung gefunden (keine deutlich längere Flugphase). Sind Absprung und Landung im Ausschnitt? Für Distanzen zur Hürde im Einrichten unter „Details“ jede Hürde markieren.</p>'; $('hurdleNums').innerHTML = ''; $('hurdleMore').innerHTML = ''; return; }
  if (state.hSel !== 'all' && !hs.some((h) => h.nr === state.hSel)) state.hSel = 'all';
  if (state.hSel === 'all' && found.length === 1) state.hSel = found[0].nr;
  $('hurdleSel').innerHTML = (found.length > 1 ? [`<button class="chip ${state.hSel === 'all' ? 'on' : ''}" data-h="all">Alle (Median)</button>`] : []).concat(hs.map((h) => `<button class="chip ${state.hSel === h.nr ? 'on' : ''}" data-h="${h.nr}"><span class="dot ${h.found ? 'd-good' : 'd-off'}"></span>Hürde ${h.nr}</button>`)).join('');
  const h = state.hSel === 'all' ? null : hs.find((x) => x.nr === state.hSel);
  if (h && !h.found) { $('hurdleInfo').innerHTML = `<div class="notice warn">Hürde ${h.nr}: ${esc(h.reason || 'nicht gefunden')}</div>`; $('hurdleNums').innerHTML = ''; $('hurdleMore').innerHTML = ''; return; }
  const autoNote = r.zoomK ? '<p class="hint small" style="margin:0 0 10px">Die Kamera zoomt – Zeiten und Winkel stimmen, Abstände in Zentimetern lassen sich so nicht verlässlich messen.</p>' : hs.some((x) => x.auto) ? '<p class="hint small" style="margin:0 0 10px">Ohne Markierung über die langen Flugphasen erkannt – Zeiten, Hürdenschritt und Winkel stimmen, Abstände zur Hürde gibt es erst mit Markierung.</p>' : '';
  const warnNote = h && h.warn ? `<div class="notice warn small">${esc(h.warn)}</div>` : '';
  const val = (m) => (h ? h[m.key] : sum['h_' + m.key]);
  $('hurdleInfo').innerHTML = autoNote + warnNote + (h ? `<div class="row" style="align-items:center;margin-bottom:10px"><span class="hint small grow">Absprung mit ${h.takeoffSide === 'L' ? 'links' : 'rechts'}, Schwungbein ${h.takeoffSide === 'L' ? 'rechts' : 'links'}.</span><button class="btn tint sm" data-hv="to">Absprung im Video</button><button class="btn tint sm" data-hv="cross">Über der Hürde</button></div>` : `<p class="hint small" style="margin:0 0 10px">Median über ${found.length} Hürden. Einzelne Hürde antippen für Details und Video.</p>`);
  const MAIN = ['takeoffCm', 'landingCm', 'flightMs', 'contactTOMs', 'contactLDMs', 'strideCm'];
  const tile = (m) => `<div class="key"><div class="l">${esc(m.label)}</div><div class="v">${fmt(val(m), m.digits)}<small>${esc(m.unit)}</small></div></div>`;
  const DIST = ['takeoffCm', 'landingCm', 'strideCm', 'takeoffPct', 'lastStepCm', 'firstStepCm', 'peakPosCm', 'hipOverBarCm'];
  const ok = HURDLE_METRICS.filter((m) => Number.isFinite(val(m)) && !(r.zoomK && DIST.includes(m.key))), main = ok.filter((m) => MAIN.includes(m.key)), rest = ok.filter((m) => !MAIN.includes(m.key));
  $('hurdleNums').innerHTML = ok.length ? main.map(tile).join('') : '<p class="hint">Keine Werte berechenbar.</p>';
  $('hurdleMore').innerHTML = (rest.length ? `<details class="more"><summary>Alle Hürdenwerte (${rest.length} weitere)</summary><div class="keys">${rest.map(tile).join('')}</div></details>` : '') + splitsHtml(r);
}
// Von Hürde zu Hürde: Zeit von Landung zu Landung, Schritte dazwischen und (mit Hürdenabstand) das Tempo
function hurdleSplits(r) {
  const fs = (r.hurdles || []).filter((h) => h.found && Number.isFinite(h.landingIndex)).sort((a, b) => a.landingIndex - b.landingIndex);
  const tdOf = (h) => { const c = r.contacts.find((x) => x.i0 === h.landingIndex); return c && Number.isFinite(c.td) ? c.td : h.landingIndex; };
  const out = [];
  for (let k = 1; k < fs.length; k++) { const a = fs[k - 1], b = fs[k]; out.push({ from: a.nr, to: b.nr, t: (tdOf(b) - tdOf(a)) / r.fps, steps: r.contacts.filter((c) => c.i0 > a.landingIndex && c.i1 <= b.takeoffIndex).length }); }
  return out;
}
const hSpace = () => { try { return parseNum(localStorage.getItem('sprintanalyse.hspace')) || 0; } catch { return 0; } };
function hSpaceFor(r) {
  const m = hSpace(); if (m > 0) return m;
  const sp = r ? hurdleSplits(r) : []; return sp.length && median(sp.map((x) => x.t)) > 2.8 ? 35 : 0;
}
function splitsHtml(r) {
  const sp = hurdleSplits(r); if (!sp.length) return '';
  const m = hSpaceFor(r), tMax = Math.max(...sp.map((x) => x.t));
  return `<h3 class="sect" style="font-size:20px">Von Hürde zu Hürde</h3>
    <div class="splits">${sp.map((x) => `<div class="split-row"><b>H${x.from} → H${x.to}</b><span class="bar"><i style="width:${Math.round(100 * x.t / tMax)}%"></i></span><span class="tm num">${fmt(x.t, 2)} s</span><span class="meta">${x.steps} Schritte${m > 0 ? ` · ${fmt(m / x.t, 2)} m/s · ${fmt(m / x.t * 3.6, 1)} km/h` : ''}</span></div>`).join('')}</div>
    <label class="f" style="max-width:240px;margin-top:10px">Hürdenabstand in m (für das Tempo)<input id="hSpaceIn" inputmode="decimal" list="hSpaceList" placeholder="z. B. 35" value="${m > 0 ? String(m).replace('.', ',') : ''}"></label>
    <datalist id="hSpaceList"><option value="35">400 m Hürden</option><option value="9,14">110 m Hürden</option><option value="8,5">100 m Hürden</option></datalist>
    <p class="hint small" style="margin:6px 2px 0">Gemessen von Landung zu Landung.</p>`;
}
$('hurdleMore').addEventListener('change', (e) => { if (e.target.id !== 'hSpaceIn') return; try { localStorage.setItem('sprintanalyse.hspace', String(parseNum(e.target.value) || '')); } catch {} renderHurdleBlock(sumNow()); });
$('hurdleSel').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; state.hSel = b.dataset.h === 'all' ? 'all' : +b.dataset.h; renderHurdleBlock(sumNow()); });
$('hurdleInfo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hv]'); if (!b) return;
  const h = (state.result.hurdles || []).find((x) => x.nr === state.hSel); if (!h) return;
  vc.keepFrame = b.dataset.hv === 'to' ? h.takeoffIndex : h.crossIndex; resTabs.set('check'); showPane('check');
});


// Kurz gesagt: das Ergebnis in zwei, drei Sätzen
function renderSummary(sum, phase, items, cats) {
  const el = $('resSummary'); if (!el) return;
  if (!sum.steps) { el.innerHTML = '<h2>Keine vollständigen Schritte erkannt</h2><p>Prüfe den Ausschnitt: Sind mindestens zwei, drei ganze Schritte mit Füßen im Bild? Unter „Im Video › Schritte korrigieren“ kannst du fehlende Schritte selbst setzen.</p>'; return; }
  const st = cats.map((c) => ({ c, ...areaStats(c, sum, phase) })).filter((x) => x.n);
  const best = st.slice().sort((a, b) => b.good / b.n - a.good / a.n || b.n - a.n)[0];
  const top = items[0];
  const head = !top ? 'Sauberer Lauf – alles mit Richtwert im grünen Bereich' : top.e.status === 'off' ? `Größter Hebel: ${shortLabel(top.k)}` : `Fast alles passt – Feinschliff bei ${shortLabel(top.k)}`;
  const ps = [`${sum.steps} Schritte ausgewertet, bewertet als ${phaseName(phase)}.`];
  if (best && best.good) ps.push(`Am saubersten: ${best.c.label} (${best.good} von ${best.n} Werten im Richtbereich).`);
  if (top && top.e.ref[top.e.side]) ps.push(top.e.ref[top.e.side]);
  const hs = (state.result.hurdles || []).filter((h) => h.found);
  if (state.analysisOpts.mode === 'hurdle') ps.push(hs.length ? `${hs.length} Hürdenüberquerung${hs.length > 1 ? 'en' : ''} erkannt – Details weiter unten.` : 'Keine Hürdenüberquerung erkannt.');
  el.innerHTML = `<h2>${esc(head)}</h2>${ps.map((t) => `<p>${esc(t)}</p>`).join('')}<div class="legend"><span><i class="dot d-good"></i>im Richtbereich</span><span><i class="dot d-near"></i>knapp daneben</span><span><i class="dot d-off"></i>deutlich daneben</span></div>`;
}
// ---------- Bereiche ----------
function refBar(key, v, phase, vB) {
  const r = REF[phase] && REF[phase][key]; if (!r || !Number.isFinite(v)) return '';
  const w = r.hi - r.lo, lo = Math.min(r.lo - w * 0.8, v, vB ?? v), hi = Math.max(r.hi + w * 0.8, v, vB ?? v);
  const X = (x) => ((x - lo) / (hi - lo) * 100).toFixed(1) + '%';
  return `<div class="refbar"><div class="zone" style="left:${X(r.lo)};width:calc(${X(r.hi)} - ${X(r.lo)})"></div><div class="me" style="left:${X(v)}"></div>${Number.isFinite(vB) ? `<div class="me b" style="left:${X(vB)}"></div>` : ''}<span class="lbl" style="left:${X(r.lo)}">${r.lo}</span><span class="lbl" style="left:${X(r.hi)}">${r.hi}</span></div>`;
}
const ST_TXT = { good: 'im Richtbereich', near: 'knapp daneben', off: 'außerhalb des Richtbereichs' };
const noneTxt = (key) => { const ph = PHASES.filter((p) => REF[p.id] && REF[p.id][key]).map((p) => p.short); return ph.length ? `Richtwert nur für ${ph.join(' und ')}` : 'ohne Richtwert, zum Vergleichen deiner Läufe'; };
function metricRow(k, sum, phase) {
  const m = M(k), e = evaluate(k, sum[k], phase);
  return `<div class="mrow" data-metric="${k}"><div class="top2"><span class="nm">${esc(m.label)}</span><span class="val ${e.status !== 'none' ? 't-' + e.status : ''}">${fmt(sum[k], m.digits)}<small>${esc(m.unit)}</small></span></div>
    <div class="hint small">${e.ref ? `Richtwert ${e.ref.lo}–${e.ref.hi} ${esc(m.unit)}, ${ST_TXT[e.status]}` : esc(noneTxt(k))}</div>${refBar(k, sum[k], phase)}
    ${e.ref && e.side && e.ref[e.side] ? `<div class="tip">${esc(e.ref[e.side])}</div>` : ''}</div>`;
}
function renderAreas(sum, phase) {
  const fixed = state.analysisOpts.camera === 'fixed';
  const cats = CATEGORIES.filter((c) => c.keys.some((k) => Number.isFinite(sum[k])));
  $('areaList').innerHTML = cats.map((c) => {
    const st = areaStats(c, sum, phase);
    const keys = c.keys.filter((k) => Number.isFinite(sum[k]) && (fixed || !M(k).fixedOnly));
    return `<div class="list" style="margin-bottom:14px" id="area-${c.id}"><div class="area-h"><span class="dot d-${st.status}"></span><h3>${esc(c.label)}</h3><span class="hint small">${st.n ? `${st.good}/${st.n}` : ''}</span></div>
      <div style="padding:0 16px"><p class="hint small" style="margin:10px 0">${esc(c.info)}</p></div>${keys.map((k) => metricRow(k, sum, phase)).join('')}</div>`;
  }).join('') || '<div class="empty"><b>Keine Bewertung möglich</b>Es wurden keine vollständigen Schritte erkannt.</div>';
  $('areaList').onclick = (e) => { const r = e.target.closest('[data-metric]'); if (r) openCheck(r.dataset.metric); };
}

// ---------- Schritte ----------
function renderSteps() {
  const r = state.result, moved = state.analysisOpts.camera === 'fixed' || r.camMoved;
  const cols = [['contactMs', 'Kontakt', 0, 'ms'], ['flightMs', 'Flug', 0, 'ms'], ['stepLenM', 'Schrittlänge', 2, 'm'], ['touchdownCm', 'Aufsetzen vor Hüfte', 0, 'cm'], ['kneeLiftDeg', 'Kniehub', 0, '°'], ['bodyLeanTO', 'Vorlage Abdruck', 0, '°']].filter((c) => (c[0] !== 'stepLenM' || moved) && r.steps.some((x) => Number.isFinite(x[c[0]])));
  const conf = (c) => (c >= 0.8 ? ['gut erkannt', 't-good'] : c >= 0.55 ? ['mittel erkannt', 't-near'] : ['unsicher erkannt', 't-off']);
  $('stepTable').innerHTML = r.steps.length ? r.steps.map((st) => {
    const [ct, cc] = conf(st.confidence ?? 1);
    const role = st.hurdleRole ? `<span class="pill hurdle">${esc(st.hurdleRole)}</span>` : st.hurdleStep ? '<span class="pill hurdle">Hürde</span>' : '';
    return `<div class="stepcard ${st.include ? '' : 'off'}" data-step="${st.index}">
      <div class="sc-top"><label class="sc-inc"><input type="checkbox" data-inc="${st.index}" ${st.include ? 'checked' : ''} ${st.partial ? 'disabled' : ''}></label>
        <b>Schritt ${st.index}</b><span class="pill side ${st.side}">${st.side === 'L' ? 'links' : 'rechts'}</span>${role}${st.oblique ? '<span class="pill">schräg</span>' : ''}${st.recovered ? '<span class="pill">ergänzt</span>' : ''}${st.manual ? '<span class="pill">korrigiert</span>' : ''}
        <span class="sc-conf ${cc}">${st.partial ? 'unvollständig' : ct}</span></div>
      <div class="sc-vals">${cols.map((c) => `<div><span>${c[1]}</span><b class="num">${fmt(st[c[0]], c[2])}<small> ${c[3]}</small></b></div>`).join('')}</div>
      ${st.flags && st.flags.length ? `<div class="hint small" style="margin-top:6px">${esc(st.flags.join(', '))}</div>` : ''}
    </div>`;
  }).join('') : '<p class="hint">Keine Bodenkontakte erkannt.</p>';
}
$('stepTable').addEventListener('click', (e) => {
  const cb = e.target.closest('input[data-inc]');
  if (cb) { const s = state.result.steps.find((x) => x.index === +cb.dataset.inc); s.include = cb.checked; state.dirty = true; renderResult(); return; }
  if (e.target.closest('.sc-inc')) return;
  const tr = e.target.closest('[data-step]'); if (tr) { vc.stepIdx = +tr.dataset.step - 1; openCheck(vc.metric || 'contactMs', vc.stepIdx); }
});

$('diagBtn').onclick = () => {
  if (!state.frames) return;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const data = { app: 'sprint-analyse-diagnose', v: 1, created: new Date().toISOString(), file: state.file ? state.file.name : '', fileFps: state.fileFps, i0Frame: state.i0Frame,
    opts: state.analysisOpts, steps: state.result.steps.length, contacts: state.result.contacts.map((c) => ({ i0: c.i0, i1: c.i1, side: c.side })),
    frames: state.frames.map((f) => (f.lm ? f.lm.map((p) => [r4(p[0]), r4(p[1]), Math.round(p[2] * 100) / 100]) : null)) };
  offerFile(`sprint-diagnose-${today()}.json`, JSON.stringify(data), 'application/json');
  toast('Datei erstellt – schick sie im Chat an Claude');
};

// ======================= Video-Check =======================
// Für jede Kennzahl: in welchem Moment gemessen wird und was eingezeichnet wird
const VIS = {
  touchdownCm: { m: 'td', how: 'Beim Aufsetzen: waagrechter Abstand vom Fuß zur Hüfte. Positiv = Fuß vor der Hüfte, negativ = hinter der Hüfte.' },
  shinTD: { m: 'td', how: 'Beim Aufsetzen: Neigung des Unterschenkels gegen die Senkrechte. Positiv = Knie vor dem Knöchel.' },
  kneeTD: { m: 'td', how: 'Beim Aufsetzen: Winkel Hüfte–Knie–Knöchel des Standbeins (180° = gestreckt).' },
  footAngleTD: { m: 'td', how: 'Beim Aufsetzen: Neigung der Linie Ferse → Zehen gegen den Boden. Positiv = Ferse zuerst, negativ = Ballen zuerst.' },
  ankleTD: { m: 'td', how: 'Beim Aufsetzen: Winkel Knie–Knöchel–Zehen.' },
  vGain: { m: 'td', how: 'Tempo beim Abdruck minus Tempo beim Aufsetzen dieses Stützes (Schätzung). Siehe „Verlauf & Kraft“.' },
  vBrake: { m: 'td', how: 'Wie stark das Tempo nach dem Aufsetzen einbricht (Schätzung). Siehe „Verlauf & Kraft“.' },
  fMean: { m: 'mid', how: 'Mittlere Vertikalkraft im Stütz in Körpergewichten, geschätzt aus der Hüftbeschleunigung.' },
  thighSepTD: { m: 'td', how: 'Beim Aufsetzen: Winkel zwischen beiden Oberschenkeln.' },
  kneeMinStance: { m: 'mid', how: 'Kleinster Kniewinkel im Stütz – hier in der Stützmitte gezeigt.' },
  kneeLiftDeg: { m: 'kneeLift', how: 'Höchster Punkt des Knies: Oberschenkel gegen die Senkrechte.' },
  hipExtTO: { m: 'to', how: 'Beim Abdruck: hinterer Oberschenkel gegen die Senkrechte.' },
  kneeTO: { m: 'to', how: 'Beim Abdruck: Kniewinkel des Abdruckbeins.' },
  trunkDeg: { m: 'mid', how: 'Neigung Hüfte → Schulter gegen die Senkrechte (Mittel über den Schritt).' },
  bodyLeanTO: { m: 'to', how: 'Beim Abdruck: Neigung der Linie Fuß → Schulter gegen die Senkrechte.' },
  hipKinkTO: { m: 'to', how: 'Beim Abdruck: wie weit die Hüfte von der Linie Fuß → Schulter abweicht. 0 = gerade Linie.' },
  hipFlexMid: { m: 'mid', how: 'In der Stützmitte: Winkel zwischen Rumpf und Standbein-Oberschenkel. 0 = in einer Linie.' },
  hipHeightMid: { m: 'mid', how: 'In der Stützmitte: Höhe der Hüfte über dem Boden, verglichen mit der Hüfthöhe im Stand.' },
  vertOscCm: { m: 'mid', how: 'Auf und Ab der Hüfte über einen Schritt (Weg der Hüfte eingezeichnet).' },
  armFwdDeg: { m: 'armF', how: 'Arm ganz vorne: Oberarm gegen die Senkrechte.' },
  armBackDeg: { m: 'armB', how: 'Arm ganz hinten: Oberarm gegen die Senkrechte.' },
  elbowFrontDeg: { m: 'armF', how: 'Arm ganz vorne: Winkel im Ellbogen.' },
  elbowBackDeg: { m: 'armB', how: 'Arm ganz hinten: Winkel im Ellbogen.' },
  armAsymDeg: { m: 'armF', how: 'Unterschied im Schwungbereich zwischen linkem und rechtem Arm.' },
  armRangeDeg: { m: 'armF', how: 'Schwungbereich des Oberarms von ganz hinten bis ganz vorne.' },
  elbowDeg: { m: 'armF', how: 'Mittlerer Ellbogenwinkel über den Schritt.' },
  contactMs: { m: 'td', how: 'Zeit vom Aufsetzen bis zum Abdruck. Grün = Fuß am Boden.' },
  flightMs: { m: 'to', how: 'Zeit vom Abdruck bis zum nächsten Aufsetzen.' },
  cadenceHz: { m: 'td', how: 'Schritte pro Sekunde (Aufsetzen bis nächstes Aufsetzen).' },
  stepLenM: { m: 'td', how: 'Abstand zwischen zwei aufeinanderfolgenden Aufsetzpunkten.' },
  speedMs: { m: 'td', how: 'Schrittlänge geteilt durch Schrittzeit.' },
};
const vc = { metric: null, stepIdx: 0, frame: 0, playing: false, raw: false, full: false };
function momentFrame(st, m) { return { td: st.i0, to: st.i1, mid: st.iMid ?? Math.round((st.i0 + st.i1) / 2), kneeLift: st.iKneeLift ?? st.i0, armF: st.iArmF ?? st.i0, armB: st.iArmB ?? st.i0 }[m] ?? st.i0; }
function openCheck(metric, stepIdx) {
  vc.metric = metric;
  const steps = state.result.steps;
  if (stepIdx == null) { const good = steps.filter((s) => s.include && Number.isFinite(s[metric])); const pick = good[Math.floor((good.length - 1) / 2)] || steps[0]; stepIdx = pick ? steps.indexOf(pick) : 0; }
  vc.stepIdx = stepIdx; resTabs.set('check'); showPane('check');
}
function vcMetricList() {
  const sum = sumNow(), fixed = state.analysisOpts.camera === 'fixed';
  const order = CATEGORIES.flatMap((c) => c.keys);
  return order.filter((k) => VIS[k] && Number.isFinite(sum[k]) && (fixed || !M(k).fixedOnly));
}
function setupVC() {
  const r = state.result; if (!r) return;
  const list = vcMetricList();
  if (!vc.metric || !list.includes(vc.metric)) vc.metric = list[0] || 'contactMs';
  const sum = sumNow(), phase = state.resPhase;
  $('vcMetrics').innerHTML = CATEGORIES.map((c) => { const ks = list.filter((k) => c.keys.includes(k)); return ks.length ? `<optgroup label="${esc(c.label)}">${ks.map((k) => { const stt = evaluate(k, sum[k], phase).status; return `<option value="${k}" ${k === vc.metric ? 'selected' : ''}>${stt === 'off' ? '⚠ ' : ''}${esc(shortLabel(k))}</option>`; }).join('')}</optgroup>` : ''; }).join('');
  const cv = $('vcCanvas'), sc = Math.min(1, 1280 / state.W);
  if (vc.full) { cv.width = Math.round(state.W * sc); cv.height = Math.round(state.H * sc); } else { cv.width = 900; cv.height = 900; }
  vc.views = computeViews();
  $('vcScrub').max = r.n - 1;
  $('vcTimeline').innerHTML = r.contacts.map((c) => `<div class="c ${c.side}" style="left:${c.i0 / r.n * 100}%;width:${Math.max(0.5, (c.i1 - c.i0 + 1) / r.n * 100)}%"></div>`).join('') + '<div class="cur" id="vcCur"></div>';
  renderMarks(); renderRx();
  renderVCInfo();
  if (vc.keepFrame != null) { const f = vc.keepFrame; vc.keepFrame = null; gotoVC(f); }
  else { const st = r.steps[vc.stepIdx]; gotoVC(st ? momentFrame(st, VIS[vc.metric].m) : 0); }
}
$('vcFull').addEventListener('change', (e) => { vc.full = e.target.checked; vc.keepFrame = vc.frame; setupVC(); });
$('vcMetrics').addEventListener('change', (e) => { vc.metric = e.target.value; const st = state.result.steps[vc.stepIdx]; if (!st || !Number.isFinite(st[vc.metric])) { openCheck(vc.metric); return; } setupVC(); });
function renderVCInfo() {
  const k = vc.metric, m = M(k), sum = sumNow(), phase = state.resPhase, e = evaluate(k, sum[k], phase);
  $('vcName').textContent = m.label; $('vcHow').textContent = VIS[k] ? VIS[k].how : '';
  $('vcVal').innerHTML = `<span class="${e.status !== 'none' ? 't-' + e.status : ''}">${fmt(sum[k], m.digits)}</span><span class="hint small"> ${esc(m.unit)}</span>`;
  $('vcRef').innerHTML = (e.ref ? `<div class="hint small" style="margin-top:8px">Median aller Schritte. Richtwert ${e.ref.lo}–${e.ref.hi} ${esc(m.unit)} (${esc(phaseName(phase))}).</div>${refBar(k, sum[k], phase)}` : `<div class="hint small" style="margin-top:8px">Median aller Schritte, ${esc(noneTxt(k))}.</div>`) + (e.ref && e.side && e.ref[e.side] ? `<p class="small" style="margin:6px 0 0">${esc(e.ref[e.side])}</p>` : '');
  $('vcSteps').innerHTML = state.result.steps.map((s, i) => { const v = s[k], ev = evaluate(k, v, phase).status; return `<button class="chip ${i === vc.stepIdx ? 'on' : ''}" data-i="${i}" ${Number.isFinite(v) ? '' : 'disabled style="opacity:.4"'}><span class="dot d-${s.include ? ev : 'none'}"></span>${s.index}: ${fmt(v, m.digits)}</button>`; }).join('') || '<span class="hint">Keine Schritte</span>';
}
$('vcSteps').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; vc.stepIdx = +b.dataset.i; renderVCInfo(); gotoVC(momentFrame(state.result.steps[vc.stepIdx], VIS[vc.metric].m)); });
let vcTok = 0;
async function gotoVC(i) {
  const r = state.result; i = Math.max(0, Math.min(r.n - 1, i)); vc.frame = i; $('vcScrub').value = i; paintJog(i);
  // Läuft noch ein Sprung, wird nur das neueste Ziel gemerkt: so entsteht kein Stau und das Bild folgt dem Finger
  if (vcBusy) { vcPend = i; return; }
  vcBusy = true; const tok = ++vcTok;
  try { await seekTo(state.frameTimes[i]); if (tok === vcTok && state.result === r) drawVC(i, true); }
  finally { vcBusy = false; const p = vcPend; vcPend = null; if (p != null && p !== i && state.result === r) gotoVC(p); }
}
let vcBusy = false, vcPend = null;
function stepAt(i) { const r = state.result; return r.steps.find((s, k) => i >= s.i0 && i < (r.steps[k + 1] ? r.steps[k + 1].i0 : s.i1 + 40)) || null; }
// Ausschnitt, der der Person folgt: Mitte und Größe aus den Körperpunkten, über ~0,3 s geglättet (ruhiges Bild)
function computeViews() {
  const r = state.result, n = r.n, raw = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const pts = r.smoothed.slice(11).map((a) => a[i] && unrot(a[i], i)).filter(Boolean); if (pts.length < 6) continue;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    raw[i] = [(x0 + x1) / 2, (y0 + y1) / 2, Math.max((y1 - y0) * 1.45, (x1 - x0) * 1.3)];
  }
  const w = Math.max(2, Math.round(0.15 * state.analysisOpts.fps)), out = [];
  let last = raw.find(Boolean) || [state.W / 2, state.H / 2, Math.min(state.W, state.H)];
  for (let i = 0; i < n; i++) {
    const v = []; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (raw[j]) v.push(raw[j]);
    if (v.length) last = [0, 1, 2].map((k) => v.reduce((t, q) => t + q[k], 0) / v.length);
    const size = Math.min(Math.min(state.W, state.H), Math.max(0.18 * Math.min(state.W, state.H), last[2]));
    out.push({ x0: Math.max(0, Math.min(state.W - size, last[0] - size / 2)), y0: Math.max(0, Math.min(state.H - size, last[1] - size / 2)), size });
  }
  return out;
}
function drawVC(i, fromSeek) {
  const r = state.result, cv = $('vcCanvas'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  const vw = !vc.full && vc.views && vc.views[i] ? vc.views[i] : { x0: 0, y0: 0, size: null };
  const sx = vw.size ? W / vw.size : W / state.W, sy = vw.size ? H / vw.size : H / state.H, sc = sx;
  if (vw.size) ctx.drawImage(video, vw.x0, vw.y0, vw.size, vw.size, 0, 0, W, H); else ctx.drawImage(video, 0, 0, W, H);
  const toC = (p) => { const q = unrot(p, i); return [(q[0] - vw.x0) * sx, (q[1] - vw.y0) * sy]; };
  const nx = (x) => (x * state.W - vw.x0) * sx, ny = (y) => (y * state.H - vw.y0) * sy;
  if (vc.noLines) { drawMarks(ctx, i, nx, ny, W); $('vcBadge').textContent = `${fmt(realT(i), 3)} s`; const c0 = $('vcCur'); if (c0) c0.style.left = (i / r.n * 100) + '%'; paintJog(i); return; } // nur das Video, ohne Linien
  // Bodenlinie
  const pl = r.frameTilt ? laneLineAt(i) : state.manualGL;
  if (pl) { const [p1, p2] = pl, ex = (p2.x - p1.x) * 4, ey = (p2.y - p1.y) * 4; ctx.save(); ctx.strokeStyle = 'rgba(255,214,10,.85)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(nx(p1.x - ex), ny(p1.y - ey)); ctx.lineTo(nx(p2.x + ex), ny(p2.y + ey)); ctx.stroke(); ctx.restore(); }
  else if (r.groundLine) { const g = r.groundLine, a = toC([0, g.a]), b = toC([state.W, g.a + g.b * state.W]); ctx.save(); ctx.strokeStyle = 'rgba(255,214,10,.75)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore(); }
  if (vc.raw && state.frames[i].lm) { ctx.fillStyle = 'rgba(255,255,255,.6)'; for (const p of state.frames[i].lm.slice(11)) if (p && p[2] > 0.2) { ctx.beginPath(); ctx.arc(nx(p[0]), ny(p[1]), 3, 0, 7); ctx.fill(); } }
  const c = r.contacts.find((x) => i >= x.i0 && i <= x.i1);
  const lm = r.smoothed.map((a) => { if (!a[i]) return null; const q = toC(a[i]); return [q[0] / W, q[1] / H, 1]; });
  drawPose(ctx, lm, W, H, { contactSide: c && c.side, alpha: 0.75 });
  for (const h of r.hurdles || []) {
    if (!Number.isFinite(h.xW)) continue;
    const ref = h.found ? h.crossIndex : h.markIndex; if (Math.abs(i - ref) > 0.8 * state.analysisOpts.fps) continue;
    const off = r.camOff ? r.camOff[i] : 0, p = toC([h.xW - off, h.yBar]);
    if (p[0] < -20 || p[0] > W + 20) continue;
    ctx.save(); ctx.fillStyle = '#2F6FEB'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, 7); ctx.fill(); ctx.stroke();
    const tag = h.found && i === h.takeoffIndex ? ' Absprung' : h.found && i === h.landingIndex ? ' Landung' : h.found && i === h.crossIndex ? ' über der Hürde' : '';
    ctx.font = '600 14px -apple-system, system-ui'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4; ctx.fillText('H' + h.nr + tag, p[0] + 12, p[1] - 10); ctx.restore();
  }
  const st = r.steps[vc.stepIdx] && i >= r.steps[vc.stepIdx].i0 - 2 && i <= (r.steps[vc.stepIdx + 1] ? r.steps[vc.stepIdx + 1].i0 : r.steps[vc.stepIdx].i1 + 40) ? r.steps[vc.stepIdx] : stepAt(i);
  const live = annotate(ctx, vc.metric, st, i, toC, sc);
  const isMoment = st && momentFrame(st, VIS[vc.metric].m) === i;
  const m = M(vc.metric);
  $('vcBadge').textContent = isMoment ? `Messmoment Schritt ${st.index}: ${fmt(st[vc.metric], m.digits)} ${m.unit}` : `${c ? 'Bodenkontakt ' + (c.side === 'L' ? 'links' : 'rechts') : 'Flugphase'}${Number.isFinite(live) ? `, jetzt ${fmt(live, m.digits)} ${m.unit}` : ''}`;
  const cur = $('vcCur'); if (cur) cur.style.left = (i / r.n * 100) + '%';
  paintJog(i); drawMarks(ctx, i, nx, ny, W);
  const tc = editTarget(i);
  $('edTarget').textContent = tc ? `Bild ${i + 1}: ${i >= tc.i0 && i <= tc.i1 ? 'im' : 'nächster'} Kontakt ${r.contacts.indexOf(tc) + 1} (${tc.side === 'L' ? 'links' : 'rechts'}, Bild ${tc.i0 + 1}–${tc.i1 + 1})${tc.manual ? ', von dir korrigiert' : ''}.` : `Bild ${i + 1}: kein Kontakt in der Nähe.`;
  $('edReset').hidden = !r.edited;
}
// ---------- Kontakte von Hand korrigieren ----------
function editTarget(i) {
  const cs = state.result.contacts; if (!cs.length) return null;
  const inside = cs.find((c) => i >= c.i0 && i <= c.i1); if (inside) return inside;
  return cs.reduce((a, c) => (Math.min(Math.abs(c.i0 - i), Math.abs(c.i1 - i)) < Math.min(Math.abs(a.i0 - i), Math.abs(a.i1 - i)) ? c : a));
}
function applyContacts(list, msg) {
  const forced = list.filter((c) => c.i1 >= c.i0).sort((a, b) => a.i0 - b.i0);
  const keepSel = state.result.steps.map((x) => x.include);
  state.result = runAnalyze({ ...state.analysisOpts, forcedContacts: forced });
  const sum = summarize(state.result); state.result.stride = extractStride(state.result); if (state.result.stride) state.result.stride.speed = sum.speedMs || null;
  state.dirty = true; vc.keepFrame = vc.frame; renderResult(); toast(msg);
}
const curList = () => state.result.contacts.map((c) => ({ i0: c.i0, i1: c.i1, side: c.side, td: c.td, to: c.to, manual: c.manual }));
$('edStart').onclick = () => {
  const i = vc.frame, list = curList(), t = editTarget(i); if (!t) return;
  const k = state.result.contacts.indexOf(t);
  if (i > list[k].i1) return toast('Das Bild liegt hinter dem Kontaktende – nutze „Kontakt endet hier“.');
  list[k] = { ...list[k], i0: i, manual: true }; applyContacts(list, 'Kontaktbeginn gesetzt');
};
$('edEnd').onclick = () => {
  const i = vc.frame, list = curList(), t = editTarget(i); if (!t) return;
  const k = state.result.contacts.indexOf(t);
  if (i < list[k].i0) return toast('Das Bild liegt vor dem Kontaktbeginn – nutze „Kontakt beginnt hier“.');
  list[k] = { ...list[k], i1: i, manual: true }; applyContacts(list, 'Kontaktende gesetzt');
};
const addContact = (side) => {
  const i = vc.frame, list = curList();
  if (list.some((c) => c.side === side && i >= c.i0 && i <= c.i1)) return toast('Hier ist schon ein Kontakt mit diesem Fuß.');
  const next = list.filter((c) => c.i0 > i).sort((a, b) => a.i0 - b.i0)[0];
  const len = Math.max(2, Math.round(0.11 * state.analysisOpts.fps));
  const i1 = Math.min(state.result.n - 1, next ? Math.min(next.i0 - 1, i + len) : i + len);
  list.push({ i0: i, i1, side, manual: true }); applyContacts(list, 'Kontakt hinzugefügt – Ende mit „Kontakt endet hier“ anpassen');
};
$('edAddL').onclick = () => addContact('L');
$('edAddR').onclick = () => addContact('R');
$('edDel').onclick = async () => {
  const t = editTarget(vc.frame); if (!t || !(vc.frame >= t.i0 && vc.frame <= t.i1)) return toast('Gehe zuerst auf ein Bild innerhalb des Kontakts.');
  const k = state.result.contacts.indexOf(t); const list = curList(); list.splice(k, 1); applyContacts(list, 'Kontakt gelöscht');
};
$('edReset').onclick = () => { state.result = runAnalyze({ ...state.analysisOpts }); const sum = summarize(state.result); state.result.stride = extractStride(state.result); if (state.result.stride) state.result.stride.speed = sum.speedMs || null; state.dirty = true; vc.keepFrame = vc.frame; renderResult(); toast('Automatische Erkennung wiederhergestellt'); };
// ======================= Korrigieren =======================
const ed = { frame: 0, sel: null, undo: [], playing: false, drag: null, glDrag: null, glTemp: null };
const edCamSeg = initSeg($('edCam'), (v) => edRecompute({ camera: v }, v === 'pan' ? 'Auf „schwenkt mit“ umgestellt' : 'Auf „Stativ“ umgestellt'));
function edSnapshot() { return { contacts: state.result.edited ? curList() : null, laneLine: state.analysisOpts.laneLine || null, camera: state.analysisOpts.camera, manualGL: state.manualGL || null, tiltKeys: (state.tiltKeys || []).map((k) => ({ ...k })) }; }
function edRun(contacts) {
  const o = { ...state.analysisOpts }; if (contacts) o.forcedContacts = contacts.filter((c) => c.i1 >= c.i0).sort((a, b) => a.i0 - b.i0);
  state.result = runAnalyze(o);
  const sum = summarize(state.result); state.result.stride = extractStride(state.result); if (state.result.stride) state.result.stride.speed = sum.speedMs || null;
  state.dirty = true; vc.keepFrame = ed.frame; renderResult();
}
function edRecompute(patch, msg, contacts) {
  ed.undo.push(edSnapshot()); ed.sel = null;
  Object.assign(state.analysisOpts, patch);
  if (patch.camera === 'pan') state.analysisOpts.calib = null;
  edRun(contacts !== undefined ? contacts : (state.result.edited ? curList() : null)); toast(msg);
}
function edApply(list, msg, selKey) {
  ed.undo.push(edSnapshot());
  edRun(list.map((c) => ({ ...c })));
  ed.sel = selKey ? state.result.contacts.findIndex((c) => c.side === selKey.side && Math.abs(c.i0 - selKey.i0) <= 1) : null; if (ed.sel < 0) ed.sel = null;
  renderEdTL(); toast(msg);
}
$('edUndo').onclick = () => {
  const u = ed.undo.pop(); if (!u) return;
  Object.assign(state.analysisOpts, { laneLine: u.laneLine, camera: u.camera }); state.manualGL = u.manualGL; state.tiltKeys = u.tiltKeys; edCamSeg.set(u.camera);
  ed.sel = null; edRun(u.contacts); toast('Rückgängig gemacht');
};
$('edAuto').onclick = () => { ed.sel = null; edRecompute({}, 'Automatische Schritterkennung wiederhergestellt', null); };
$('glAuto').onclick = () => { ed.undo.push(edSnapshot()); state.manualGL = null; state.tiltKeys = []; state.analysisOpts.laneLine = state.lane.length === 2 ? { x1: state.lane[0].x, y1: state.lane[0].y, x2: state.lane[1].x, y2: state.lane[1].y } : null; edRun(state.result.edited ? curList() : null); toast('Bodenlinie wieder automatisch'); };

const edSpan = () => { const r = state.result; return Math.min(r.n, Math.max(20, Math.round(1.6 * (state.analysisOpts.fps || 60)))); };
const edW0 = () => { const r = state.result, sp = edSpan(); return Math.max(0, Math.min(r.n - sp, Math.round(ed.frame - sp / 2))); };
function setupEdit() {
  const r = state.result; if (!r) return;
  const cv = $('edCanvas'), sc = Math.min(1, 1280 / state.W);
  if (vc.full) { cv.width = Math.round(state.W * sc); cv.height = Math.round(state.H * sc); } else { cv.width = 900; cv.height = 900; }
  vc.views = computeViews();
  $('edScrub').max = r.n - 1; edCamSeg.set(state.analysisOpts.camera);
  if (vc.keepFrame != null) { ed.frame = vc.keepFrame; vc.keepFrame = null; }
  ed.frame = Math.max(0, Math.min(r.n - 1, ed.frame));
  renderEdTL(); gotoEd(ed.frame);
}
function renderGLInfo() {
  const r = state.result, pan = state.analysisOpts.camera === 'pan', k = (state.tiltKeys || []).length;
  $('glInfo').innerHTML = pan
    ? (r.frameTilt ? `Kamera schwenkt mit: Die Linie wird <b>in jedem Bild neu</b> aus den weißen Bahnlinien bestimmt (gefunden in ${fmt((r.laneHit || 0) * 100)} % der Bilder, Lücken werden aufgefüllt). Liegt sie in einem Bild daneben: zu dem Bild gehen und die zwei gelben Punkte auf die Bahnlinie ziehen. Jede Korrektur ist ein Zwischenpunkt – dazwischen wird die Neigung verteilt.${k ? ` <b>${k} Korrekturpunkt${k > 1 ? 'e' : ''}</b> gesetzt (Striche in der unteren Zeitleiste).` : ''}` : 'Kamera schwenkt mit, aber im Video wurden zu wenige Bahnlinien gefunden. Setze die Linie in mehreren Bildern von Hand – dazwischen wird die Neigung verteilt.')
    : '';
  if (pan && !state.laneDet) $('glInfo').innerHTML = 'Dieser Lauf wurde noch ohne Bahnlinien-Suche analysiert, deshalb bleibt die Linie stehen. <b>Einmal neu analysieren</b> – dann wird die Linie in jedem Bild neu bestimmt.<br><button class="btn primary sm" id="edRedetect" style="margin-top:8px">Neu analysieren</button>';
  const rd = $('edRedetect'); if (rd) rd.onclick = () => { state.camera = 'pan'; segCam.set('pan'); runAnalysis(); };
  if (!pan) $('glInfo').innerHTML = 'Die gelbe Linie zeigt, wo die Analyse den Boden und die Laufrichtung vermutet. Liegt sie daneben: die <b>zwei gelben Punkte im Video</b> auf eine Bahnlinie unter deinen Füßen ziehen. Danach wird alles neu berechnet.';
}
function renderEdTL() {
  const r = state.result; if (!r) return; const sp = edSpan(), w0 = edW0();
  const pct = (i) => ((i - w0) / sp * 100);
  ['L', 'R'].forEach((side) => {
    const row = $('edTL').querySelector(`.edrow[data-side="${side}"]`);
    row.querySelectorAll('.edbar').forEach((b) => b.remove());
    r.contacts.forEach((c, k) => {
      if (c.side !== side || c.i1 < w0 || c.i0 > w0 + sp) return;
      const d = document.createElement('div'); d.className = `edbar ${side}${c.manual ? ' man' : ''}${k === ed.sel ? ' sel' : ''}`; d.dataset.k = k;
      d.style.left = pct(c.i0) + '%'; d.style.width = Math.max(0.8, (c.i1 - c.i0 + 1) / sp * 100) + '%'; row.appendChild(d);
    });
  });
  $('edCur').style.left = pct(ed.frame + 0.5) + '%';
  $('edMini').innerHTML = r.contacts.map((c) => `<div class="c ${c.side}" style="left:${c.i0 / r.n * 100}%;width:${Math.max(0.4, (c.i1 - c.i0 + 1) / r.n * 100)}%"></div>`).join('') + (state.analysisOpts.camera === 'pan' ? (state.tiltKeys || []).map((k) => `<div class="key" style="left:${k.i / r.n * 100}%"></div>`).join('') : '') + `<div class="win" style="left:${w0 / r.n * 100}%;width:${sp / r.n * 100}%"></div>`;
  const c = ed.sel != null && r.contacts[ed.sel];
  $('edSelBox').hidden = !c;
  if (c) $('edSelInfo').innerHTML = `<b>Kontakt ${ed.sel + 1}</b> · ${c.side === 'L' ? 'links' : 'rechts'} · Bild ${c.i0 + 1}–${c.i1 + 1} · ${fmt((c.i1 - c.i0 + 1) / state.analysisOpts.fps * 1000)} ms`;
  $('edUndo').disabled = !ed.undo.length;
}
let edTok = 0;
async function gotoEd(i) {
  const r = state.result; i = Math.max(0, Math.min(r.n - 1, i)); ed.frame = i; $('edScrub').value = i; renderEdTL();
  if (edBusy) { edPend = i; return; }
  edBusy = true; const tok = ++edTok;
  try { await seekTo(state.frameTimes[i]); if (tok === edTok && state.result === r) drawEd(); }
  finally { edBusy = false; const p = edPend; edPend = null; if (p != null && p !== i && state.result === r) gotoEd(p); }
}
let edBusy = false, edPend = null;
function edGLScreen() { // Bodenlinie als zwei Punkte in normierten Bildkoordinaten
  if (ed.glTemp) return ed.glTemp;
  if (state.result && state.result.frameTilt) return laneLineAt(ed.frame);
  if (state.manualGL) return state.manualGL;
  const r = state.result, W = state.W;
  if (r.groundLine) { const g = r.groundLine; const p = (x) => { const q = rotatePt([x, g.a + g.b * x], r.tilt, state.W, state.H, true); return { x: q[0] / state.W, y: q[1] / state.H }; }; return [p(0.2 * W), p(0.8 * W)]; }
  // ohne Bodenlinie: waagrecht auf Fußhöhe des aktuellen Bildes
  const lm = state.frames[ed.frame] && state.frames[ed.frame].lm; let y = 0.92;
  if (lm) { const ys = [27, 28, 29, 30, 31, 32].map((k) => lm[k]).filter((p) => p && p[2] > 0.3).map((p) => p[1]); if (ys.length) y = Math.min(0.98, Math.max(...ys) + 0.01); }
  return [{ x: 0.2, y }, { x: 0.8, y }];
}
// Ausschnitt der Korrektur-Ansicht: Bild-Koordinaten (0..1) <-> Leinwand-Koordinaten (0..1)
const edView = () => (!vc.full && vc.views && vc.views[ed.frame]) || null;
const img2cv = (q) => { const v = edView(); return v ? { x: (q.x * state.W - v.x0) / v.size, y: (q.y * state.H - v.y0) / v.size } : q; };
const cv2img = (q) => { const v = edView(); return v ? { x: (v.x0 + q.x * v.size) / state.W, y: (v.y0 + q.y * v.size) / state.H } : q; };
function drawEd() {
  const r = state.result, cv = $('edCanvas'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, i = ed.frame;
  const v = edView(); if (v) ctx.drawImage(video, v.x0, v.y0, v.size, v.size, 0, 0, W, H); else ctx.drawImage(video, 0, 0, W, H);
  const c = r.contacts.find((x) => i >= x.i0 && i <= x.i1);
  const lm = r.smoothed.map((a) => { if (!a[i]) return null; const q = unrot(a[i], i); const m = img2cv({ x: q[0] / state.W, y: q[1] / state.H }); return [m.x, m.y, 1]; });
  drawPose(ctx, lm, W, H, { contactSide: c && c.side, alpha: 0.8 });
  // Bodenlinie mit Griffen
  const [a, b] = edGLScreen().map(img2cv), dx = (b.x - a.x) * W, dy = (b.y - a.y) * H, k = 4;
  ctx.save(); ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = Math.max(2, W / 400); ctx.setLineDash([12, 8]);
  ctx.beginPath(); ctx.moveTo(a.x * W - dx * k, a.y * H - dy * k); ctx.lineTo(b.x * W + dx * k, b.y * H + dy * k); ctx.stroke(); ctx.setLineDash([]);
  const rad = Math.max(9, W / 70);
  for (const p of [a, b]) { ctx.fillStyle = '#ffd60a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, rad, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.restore();
  $('edBadge').textContent = `Bild ${i + 1}/${r.n} · ${c ? 'Kontakt ' + (c.side === 'L' ? 'links' : 'rechts') : 'Flugphase'}${r.frameTilt ? ((state.tiltKeys || []).some((k) => k.i === i) ? ' · Linie von dir' : ' · Linie automatisch') : state.manualGL ? ' · Bodenlinie von dir' : ''}`;
  renderGLInfo();
}
// Transport
$('edPrev').onclick = () => { edStop(); gotoEd(ed.frame - 1); };
$('edNext').onclick = () => { edStop(); gotoEd(ed.frame + 1); };
$('edScrub').oninput = (e) => { edStop(); gotoEd(+e.target.value); };
function edStop() { ed.playing = false; setPlay($('edPlay'), false); }
$('edPlay').onclick = async () => {
  if (ed.playing) return edStop();
  ed.playing = true; setPlay($('edPlay'), true);
  while (ed.playing && ed.frame < state.result.n - 1) { await gotoEd(ed.frame + 1); await sleep(40); }
  edStop();
};
$('edMini').onclick = (e) => { const rc = $('edMini').getBoundingClientRect(); edStop(); gotoEd(Math.round((e.clientX - rc.left) / rc.width * (state.result.n - 1))); };
// Kontakte hinzufügen
function edAdd(side, at) {
  const r = state.result, i = at ?? ed.frame, list = curList();
  if (list.some((c) => c.side === side && i >= c.i0 && i <= c.i1)) return toast('Hier ist schon ein Kontakt mit diesem Fuß');
  const next = list.filter((c) => c.side === side && c.i0 > i).sort((a, b) => a.i0 - b.i0)[0];
  const len = Math.max(2, Math.round(0.1 * state.analysisOpts.fps));
  const i1 = Math.min(r.n - 1, next ? Math.min(next.i0 - 1, i + len) : i + len);
  list.push({ i0: i, i1, side, manual: true });
  edApply(list, `Kontakt ${side === 'L' ? 'links' : 'rechts'} hinzugefügt – Ende bei Bedarf ziehen`, { side, i0: i });
}
$('edAddL2').onclick = () => edAdd('L');
$('edAddR2').onclick = () => edAdd('R');
$('edDel2').onclick = () => { if (ed.sel == null) return; const list = curList(); list.splice(ed.sel, 1); ed.sel = null; edApply(list, 'Kontakt gelöscht'); };
$('edSwap').onclick = () => { if (ed.sel == null) return; const list = curList(); const c = list[ed.sel]; c.side = c.side === 'L' ? 'R' : 'L'; c.manual = true; edApply(list, 'Fuß getauscht', { side: c.side, i0: c.i0 }); };
// Zeitleiste: Balkenenden ziehen, antippen, lange drücken
const edTL = $('edTL');
function tlFrame(e) { const rc = edTL.getBoundingClientRect(); return { f: edW0() + (e.clientX - rc.left) / rc.width * edSpan(), x: e.clientX - rc.left, w: rc.width, side: (e.clientY - rc.top) < rc.height / 2 ? 'L' : 'R' }; }
edTL.addEventListener('pointerdown', (e) => {
  const r = state.result; if (!r) return; edStop();
  const p = tlFrame(e), pxPerF = p.w / edSpan(), w0 = edW0();
  let hit = null;
  r.contacts.forEach((c, k) => {
    if (c.side !== p.side) return;
    const xa = (c.i0 - w0) * pxPerF, xb = (c.i1 + 1 - w0) * pxPerF;
    if (p.x > xa - 8 && p.x < xa + 14) hit = hit || { k, edge: 'i0' }; else if (p.x > xb - 14 && p.x < xb + 8) hit = hit || { k, edge: 'i1' }; else if (p.x > xa && p.x < xb) hit = hit || { k, edge: null };
  });
  edTL.setPointerCapture(e.pointerId);
  if (hit && hit.edge) { ed.sel = hit.k; ed.drag = { ...hit, list: curList(), w0, moved: false }; renderEdTL(); return; }
  if (hit) { ed.sel = hit.k; ed.drag = null; renderEdTL(); gotoEd(r.contacts[hit.k].i0); return; }
  ed.sel = null; const f = Math.round(p.f); gotoEd(f);
  ed.drag = { press: true, side: p.side, f, x: e.clientX, timer: setTimeout(() => { if (ed.drag && ed.drag.press) { const d = ed.drag; ed.drag = null; if (navigator.vibrate) navigator.vibrate(15); edAdd(d.side, d.f); } }, 450) };
});
edTL.addEventListener('pointermove', (e) => {
  const d = ed.drag; if (!d) return;
  if (d.press) { if (Math.abs(e.clientX - d.x) > 8) { clearTimeout(d.timer); d.press = false; d.scrub = true; } }
  if (d.scrub) { const f = Math.round(tlFrame(e).f); if (f !== ed.frame) gotoEd(f); return; }
  if (!d.edge) return;
  const rc = edTL.getBoundingClientRect(), f = Math.round(d.w0 + (e.clientX - rc.left) / rc.width * edSpan()), c = d.list[d.k];
  if (d.edge === 'i0') c.i0 = Math.max(0, Math.min(c.i1, f)); else c.i1 = Math.min(state.result.n - 1, Math.max(c.i0, f - 1));
  d.moved = true;
  // Vorschau ohne Neuberechnung
  const bar = edTL.querySelector(`.edbar[data-k="${d.k}"]`), sp = edSpan();
  if (bar) { bar.style.left = ((c.i0 - d.w0) / sp * 100) + '%'; bar.style.width = Math.max(0.8, (c.i1 - c.i0 + 1) / sp * 100) + '%'; }
  const tf = d.edge === 'i0' ? c.i0 : c.i1; if (tf !== ed.frame) { ed.frame = tf; $('edScrub').value = tf; $('edCur').style.left = ((tf - d.w0 + 0.5) / sp * 100) + '%'; const tok = ++edTok; seekTo(state.frameTimes[tf]).then(() => { if (tok === edTok) drawEd(); }); }
});
function edTLUp() {
  const d = ed.drag; ed.drag = null; if (!d) return;
  if (d.timer) clearTimeout(d.timer);
  if (d.edge && d.moved) { const c = d.list[d.k]; c.manual = true; edApply(d.list, d.edge === 'i0' ? 'Aufsetzen verschoben' : 'Abdruck verschoben', { side: c.side, i0: c.i0 }); }
}
edTL.addEventListener('pointerup', edTLUp);
edTL.addEventListener('pointercancel', () => { if (ed.drag && ed.drag.timer) clearTimeout(ed.drag.timer); ed.drag = null; renderEdTL(); });
// Bodenlinie im Video ziehen
const edCv = $('edCanvas');
function cvPt(e) { const rc = edCv.getBoundingClientRect(); const c = { x: Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)), y: Math.max(0, Math.min(1, (e.clientY - rc.top) / rc.height)) }; const m = cv2img(c); return { x: m.x, y: m.y, cx: c.x, cy: c.y, rc }; }
edCv.addEventListener('pointerdown', (e) => {
  if (!state.result) return; const p = cvPt(e), pts = edGLScreen().map((q) => ({ ...q }));
  let k = -1, bd = 34; pts.forEach((q, j) => { const qc = img2cv(q); const d = Math.hypot((qc.x - p.cx) * p.rc.width, (qc.y - p.cy) * p.rc.height); if (d < bd) { bd = d; k = j; } });
  if (k < 0) { edStop(); ed.wipe = { x: e.clientX, f: ed.frame, w: p.rc.width || 300, moved: false }; try { edCv.setPointerCapture(e.pointerId); } catch {} return; }
  e.preventDefault(); edStop(); edCv.setPointerCapture(e.pointerId); ed.glDrag = k; ed.glTemp = pts;
});
edCv.addEventListener('pointermove', (e) => { if (ed.wipe) { const w = ed.wipe, dx = e.clientX - w.x; if (!w.moved && Math.abs(dx) < 8) return; w.moved = true; if (!w.wf) w.wf = makeWipe(state.result.n, w.w); const f = Math.max(0, Math.min(state.result.n - 1, w.f + Math.round(w.wf(e.clientX, e.timeStamp)))); if (f !== ed.frame) gotoEd(f); return; } if (ed.glDrag == null) return; const p = cvPt(e); ed.glTemp[ed.glDrag] = { x: p.x, y: p.y }; drawEd(); });
function edGLUp() {
  if (ed.wipe && !ed.wipe.moved && $('edCol').classList.contains('vfs')) $('edCol').classList.toggle('clean');
  ed.wipe = null;
  if (ed.glDrag == null) return; const pts = ed.glTemp; ed.glDrag = null; ed.glTemp = null;
  if (Math.abs(pts[1].x - pts[0].x) < 0.05) { drawEd(); return toast('Punkte weiter auseinander setzen'); }
  ed.undo.push(edSnapshot());
  if (state.analysisOpts.camera === 'pan') {
    let [a, b] = pts; if (b.x < a.x) [a, b] = [b, a];
    const key = { i: ed.frame, a: Math.atan2((b.y - a.y) * state.H, (b.x - a.x) * state.W), y: (a.y + b.y) / 2 };
    state.tiltKeys = (state.tiltKeys || []).filter((k) => Math.abs(k.i - ed.frame) > 1).concat([key]);
    edRun(state.result.edited ? curList() : null); toast(`Linie in Bild ${ed.frame + 1} gesetzt (${state.tiltKeys.length} Korrekturpunkt${state.tiltKeys.length > 1 ? 'e' : ''})`);
    return;
  }
  state.manualGL = pts; state.analysisOpts.laneLine = { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y };
  edRun(state.result.edited ? curList() : null); toast('Bodenlinie gesetzt – Werte neu berechnet');
}
edCv.addEventListener('pointerup', edGLUp);
edCv.addEventListener('pointercancel', () => { ed.wipe = null; ed.glDrag = null; ed.glTemp = null; drawEd(); });

// Zeichnet Messlinien und Winkel für die Kennzahl; gibt den aktuellen Wert (live) zurück
function annotate(ctx, key, st, i, toC, sc) {
  const r = state.result, P = r.smoothed, dir = r.dir;
  const pt = (k) => P[k] && P[k][i];
  const mid = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a || b);
  const side = st ? st.side : 'L', other = side === 'L' ? 'R' : 'L';
  const S = (s) => (s === 'L' ? { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ank: 27, heel: 29, toe: 31 } : { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ank: 28, heel: 30, toe: 32 });
  const hip = mid(pt(23), pt(24)), sh = mid(pt(11), pt(12)); const A = S(side), B = S(other);
  const px = (cm) => (cm / 100) / r.mPerPx;
  // Größen relativ zur Anzeigegröße, damit es auf dem Handy lesbar bleibt
  const cw = ctx.canvas.width, disp = Math.max(200, ctx.canvas.getBoundingClientRect().width || cw), k = cw / disp;
  const lw = Math.max(2, 2.6 * k);
  const font = `700 ${Math.round(14 * k)}px -apple-system, system-ui`;
  const C1 = '#FFD60A', C2 = '#FF453A', C3 = '#64D2FF';
  const line = (a, b, col, dash) => { if (!a || !b) return; const p = toC(a), q = toC(b); ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; if (dash) ctx.setLineDash([8, 6]); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.restore(); };
  const vert = (p, len) => { if (p) line(p, [p[0], p[1] - len], 'rgba(255,255,255,.85)', true); };
  const label = (p, txt, col = '#fff') => { if (!p) return; const q = toC(p); ctx.save(); ctx.font = font; const w = ctx.measureText(txt).width + 14, h = parseInt(font.split(' ')[1]) + 10; ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(q[0] + 10, q[1] - h / 2, w, h, h / 2) : ctx.rect(q[0] + 10, q[1] - h / 2, w, h); ctx.fill(); ctx.fillStyle = col; ctx.fillText(txt, q[0] + 17, q[1] + h / 2 - 8); ctx.restore(); };
  const arc = (c, a, b, col) => { if (!c || !a || !b) return; const C = toC(c), Aa = toC(a), Bb = toC(b); const a1 = Math.atan2(Aa[1] - C[1], Aa[0] - C[0]), a2 = Math.atan2(Bb[1] - C[1], Bb[0] - C[0]); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; const rad = 26 * k; ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(C[0], C[1], rad, a1, a1 + d, d < 0); ctx.stroke(); ctx.restore(); };
  const angAt = (a, b, c) => { if (!a || !b || !c) return NaN; const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]]; return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2))))) * 180 / Math.PI; };
  const fromUp = (p, q) => (p && q ? Math.atan2(dir * (q[0] - p[0]), -(q[1] - p[1])) * 180 / Math.PI : NaN);
  const fromDown = (p, q) => (p && q ? Math.atan2(dir * (q[0] - p[0]), q[1] - p[1]) * 180 / Math.PI : NaN);
  const L = 0.35 * r.legPx; let v = NaN;
  const footMid = (s) => mid(pt(S(s).heel), pt(S(s).toe)) || pt(S(s).ank);
  const gY = (x) => (r.groundLine ? r.groundLine.a + r.groundLine.b * x : r.ground[i]);
  switch (key) {
    case 'touchdownCm': case 'contactMs': case 'cadenceHz': case 'stepLenM': case 'speedMs': {
      const f = footMid(side); if (!f || !hip) break; const gy = gY(f[0]);
      vert([hip[0], gy], gy - hip[1]); line([hip[0], gy], [f[0], gy], C1); line(f, [f[0], gy], C1);
      v = dir * (f[0] - hip[0]) * r.mPerPx * 100;
      if (key === 'touchdownCm') label([f[0], gy - px(12)], `${fmt(Math.abs(v))} cm ${v >= 0 ? 'vor' : 'hinter'} der Hüfte`, C1);
      break;
    }
    case 'footAngleTD': { const h = pt(A.heel), t = pt(A.toe); line(h, t, C1); if (h && t) line(h, [h[0] + (t[0] - h[0]) * 1.2, h[1]], 'rgba(255,255,255,.8)', true); v = h && t ? Math.atan2(-(t[1] - h[1]), Math.abs(t[0] - h[0])) * 180 / Math.PI : NaN; label(t, `${fmt(v)}°`, C1); break; }
    case 'ankleTD': { const k = pt(A.knee), a = pt(A.ank), t = pt(A.toe); line(k, a, C1); line(a, t, C1); arc(a, k, t, C1); v = angAt(k, a, t); label(a, `${fmt(v)}°`, C1); break; }
    case 'shinTD': { const a = pt(A.ank), k = pt(A.knee); vert(a, L); line(a, k, C1); arc(a, [a[0], a[1] - 10], k, C1); v = fromUp(a, k); label(k, `${fmt(v)}°`, C1); break; }
    case 'kneeTD': case 'kneeTO': case 'kneeMinStance': { const h = pt(A.hip), k = pt(A.knee), a = pt(A.ank); line(h, k, C1); line(k, a, C1); arc(k, h, a, C1); v = angAt(h, k, a); label(k, `${fmt(v)}°`, C1); break; }
    case 'thighSepTD': { const k1 = pt(A.knee), k2 = pt(B.knee); line(hip, k1, C1); line(hip, k2, C3); arc(hip, k1, k2, C1); v = angAt(k1, hip, k2); label(hip, `${fmt(v)}°`, C1); break; }
    case 'kneeLiftDeg': { const t1 = fromDown(hip, pt(25)), t2 = fromDown(hip, pt(26)); const k = t1 >= t2 ? pt(25) : pt(26); vert(hip, -L); line(hip, k, C1); arc(hip, [hip[0], hip[1] + 10], k, C1); v = Math.max(t1, t2); label(k, `${fmt(v)}°`, C1); break; }
    case 'hipExtTO': { const t1 = fromDown(hip, pt(25)), t2 = fromDown(hip, pt(26)); const k = t1 <= t2 ? pt(25) : pt(26); vert(hip, -L); line(hip, k, C1); arc(hip, [hip[0], hip[1] + 10], k, C1); v = -Math.min(t1, t2); label(k, `${fmt(v)}°`, C1); break; }
    case 'trunkDeg': { vert(hip, L * 1.4); line(hip, sh, C1); arc(hip, [hip[0], hip[1] - 10], sh, C1); v = fromUp(hip, sh); label(sh, `${fmt(v, 1)}°`, C1); break; }
    case 'bodyLeanTO': case 'hipKinkTO': {
      const f = pt(A.toe) || pt(A.ank); vert(f, L * 2.2); line(f, sh, C1, key === 'hipKinkTO');
      if (key === 'bodyLeanTO') { arc(f, [f[0], f[1] - 10], sh, C1); v = fromUp(f, sh); label(mid(f, sh), `${fmt(v)}°`, C1); }
      else { const a = pt(A.ank) || f; line(a, hip, C2); line(hip, sh, C2); arc(hip, a, sh, C2); const ang = angAt(sh, hip, a); v = 180 - ang; label(hip, `${fmt(v)}° Abweichung`, C2); }
      break;
    }
    case 'hipFlexMid': { const k = pt(A.knee); line(hip, sh, C1); line(hip, k, C1); const ext = hip && sh ? [2 * hip[0] - sh[0], 2 * hip[1] - sh[1]] : null; line(hip, ext, 'rgba(255,255,255,.7)', true); arc(hip, ext, k, C1); v = 180 - angAt(sh, hip, k); label(hip, `${fmt(v)}°`, C1); break; }
    case 'hipHeightMid': case 'vertOscCm': {
      if (!hip) break; const gy = gY(hip[0]); line([hip[0], gy], hip, C1); v = (gy - hip[1]) * r.mPerPx / (0.53 * state.analysisOpts.heightCm / 100) * 100;
      if (key === 'hipHeightMid') label(hip, `${fmt(v)} % der Standhöhe`, C1);
      if (key === 'vertOscCm' && st) { ctx.save(); ctx.strokeStyle = C3; ctx.lineWidth = lw; ctx.beginPath(); let first = true; const end = r.steps[st.index] ? r.steps[st.index].i0 : st.i1 + 30; for (let j = st.i0; j <= Math.min(r.n - 1, end); j++) { const h = mid(P[23][j], P[24][j]); if (!h) continue; const q = toC(h); first ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); first = false; } ctx.stroke(); ctx.restore(); v = st.vertOscCm; label(hip, `${fmt(v, 1)} cm auf und ab`, C3); }
      break;
    }
    case 'armFwdDeg': case 'armBackDeg': case 'elbowFrontDeg': case 'elbowBackDeg': case 'armRangeDeg': case 'armAsymDeg': case 'elbowDeg': {
      const aL = fromDown(pt(11), pt(13)), aR = fromDown(pt(12), pt(14));
      const back = key === 'armBackDeg' || key === 'elbowBackDeg';
      const s = back ? (aL <= aR ? 'L' : 'R') : (aL >= aR ? 'L' : 'R'); const X = S(s); const shp = pt(X.sh), el = pt(X.el), wr = pt(X.wr);
      line(shp, el, C1); line(el, wr, C1);
      if (key.startsWith('elbow')) { arc(el, shp, wr, C1); v = angAt(shp, el, wr); label(el, `${fmt(v)}°`, C1); }
      else { vert(shp, -L * 0.9); arc(shp, [shp[0], shp[1] + 10], el, C1); v = back ? -Math.min(aL, aR) : Math.max(aL, aR); if (key === 'armFwdDeg' || key === 'armBackDeg') label(el, `${fmt(v)}°`, C1); else v = NaN; }
      break;
    }
    case 'flightMs': default: break;
  }
  return v;
}
$('vcScrub').oninput = (e) => { vcStop(); gotoVC(+e.target.value); };
$('vcPrev').onclick = () => { vcStop(); gotoVC(vc.frame - 1); };
$('vcNext').onclick = () => { vcStop(); gotoVC(vc.frame + 1); };
{ const tl = $('vcTimeline'); let on = false;
  const go = (e) => { const r = tl.getBoundingClientRect(); gotoVC(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1))) * (state.result.n - 1))); };
  tl.addEventListener('pointerdown', (e) => { if (!state.result) return; on = true; vcStop(); try { tl.setPointerCapture(e.pointerId); } catch {} go(e); });
  tl.addEventListener('pointermove', (e) => { if (on) go(e); });
  const end = () => { on = false; }; tl.addEventListener('pointerup', end); tl.addEventListener('pointercancel', end);
}
// über das Bild wischen = Bild für Bild spulen
const wipeSpan = () => Math.max(24, Math.min(120, Math.min(state.result.n, Math.round(0.6 * (state.analysisOpts.fps || 60)))));
// Gesten auf dem Bild: ein Finger wischt (spulen) oder tippt, zwei Finger zoomen und verschieben (nur in der Großansicht)
const pz = { s: 1, x: 0, y: 0 };
function applyZoom() {
  const cv = $('vcCanvas'); if (pz.s <= 1.01) { pz.s = 1; pz.x = 0; pz.y = 0; }
  cv.style.transform = pz.s === 1 ? '' : `translate(${pz.x}px, ${pz.y}px) scale(${pz.s})`;
  $('vcZoomReset').hidden = pz.s === 1; $('vcZoomReset').textContent = `${fmt(pz.s, 1)}× · Zurück`;
}
function resetZoom() { pz.s = 1; applyZoom(); }
$('vcZoomReset').onclick = (e) => { e.stopPropagation(); resetZoom(); };
{ const cv = $('vcCanvas'), pts = new Map(); let sw = null, pin = null, block = false;
  const startPinch = () => {
    const [a, b] = [...pts.values()], r = cv.getBoundingClientRect();
    const c = { x: r.left + r.width / 2 - pz.x, y: r.top + r.height / 2 - pz.y }, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pin = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: pz.s, c, q: { x: (m.x - c.x - pz.x) / pz.s, y: (m.y - c.y - pz.y) / pz.s }, w: r.width / pz.s, h: r.height / pz.s };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!state.result) return; vcStop(); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { cv.setPointerCapture(e.pointerId); } catch {}
    if (pts.size === 2 && $('vcCol').classList.contains('vfs')) { sw = null; block = true; startPinch(); return; }
    if (pts.size === 1 && !block) sw = { x: e.clientX, f: vc.frame, w: cv.getBoundingClientRect().width || 300, moved: false };
  });
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pin && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pz.s = Math.max(1, Math.min(8, pin.s0 * d / pin.d0));
      const mx = (pz.s - 1) * pin.w / 2 + 40, my = (pz.s - 1) * pin.h / 2 + 40;
      pz.x = Math.max(-mx, Math.min(mx, m.x - pin.c.x - pz.s * pin.q.x)); pz.y = Math.max(-my, Math.min(my, m.y - pin.c.y - pz.s * pin.q.y));
      applyZoom(); return;
    }
    if (!sw) return; const dx = e.clientX - sw.x; if (!sw.moved && Math.abs(dx) < 8) return; sw.moved = true; if (!sw.wf) sw.wf = makeWipe(state.result.n, sw.w); const f = Math.max(0, Math.min(state.result.n - 1, sw.f + Math.round(sw.wf(e.clientX, e.timeStamp)))); if (f !== vc.frame) gotoVC(f);
  });
  const up = (e, cancel) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pin = null;
    if (!pts.size) block = false;
    if (!cancel && sw && !sw.moved && !pin) { if (vc.markArm) addMarkAt(e); else if ($('vcCol').classList.contains('vfs')) $('vcCol').classList.toggle('clean'); }
    sw = null;
  };
  cv.addEventListener('pointerup', (e) => up(e, false)); cv.addEventListener('pointercancel', (e) => up(e, true));
}
function vcFocusMode(on) { if (on) { vc._full = vc.full; vc.full = true; } else vc.full = !!vc._full; $('vcFull').checked = vc.full; if (state.result && $('p-check').classList.contains('on')) { vc.keepFrame = vc.frame; setupVC(); } }
function clearFocus() { resetZoom(); const els = document.querySelectorAll('.vfs'); if (!els.length) return; const wasVc = $('vcCol').classList.contains('vfs'); els.forEach((el) => el.classList.remove('vfs', 'clean', 'more')); document.body.classList.remove('vfs-on'); if (wasVc) vcFocusMode(false); redrawFocus(); }
function redrawFocus() { requestAnimationFrame(() => { if (!state.result || curScreen !== 's-result') return; if ($('p-check').classList.contains('on')) drawVC(vc.frame); if ($('p-edit').classList.contains('on')) drawEd(); }); }
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-focus]');
  if (b) { const el = $(b.dataset.focus), on = !el.classList.contains('vfs'); el.classList.toggle('vfs', on); el.classList.remove('clean', 'more'); document.body.classList.toggle('vfs-on', on); b.setAttribute('aria-label', on ? 'Verkleinern' : 'Video groß anzeigen'); if (b.dataset.focus === 'vcCol') { resetZoom(); vcFocusMode(on); } redrawFocus(); return; }
  const mo = e.target.closest('[data-more]'); if (mo) { const el = mo.closest('.vfs'); if (el) el.classList.toggle('more'); return; }
  const p = e.target.closest('[data-proxy]'); if (p) { const t = $(p.dataset.proxy); if (t && !t.disabled) t.click(); else if (p.dataset.proxy === 'edDel2') toast('Erst einen Balken in der Zeitleiste antippen'); }
});
$('vcRaw').onchange = (e) => { vc.raw = e.target.checked; gotoVC(vc.frame); };
$('vcPlay').onclick = () => (vc.playing ? vcStop() : vcPlay());
function vcPlay() {
  if (!state.result) return; vc.playing = true; setPlay($('vcPlay'), true);
  const r = state.result, fileFps = state.fileFps || 30;
  const endT = state.frameTimes[r.n - 1];
  if (vc.frame >= r.n - 2) vc.frame = 0;
  video.currentTime = state.frameTimes[vc.frame]; setRate(+$('vcSpeed').value); video.muted = true;
  const useRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  const step = (now, meta) => {
    if (!vc.playing) return;
    const t = meta ? meta.mediaTime : video.currentTime;
    const i = Math.max(0, Math.min(r.n - 1, Math.round(t * fileFps - 0.5) - state.i0Frame));
    vc.frame = i; $('vcScrub').value = i; drawVC(i);
    if (t >= endT) { video.pause(); video.currentTime = state.frameTimes[0]; video.play().catch(() => vcStop()); }
    useRVFC ? video.requestVideoFrameCallback(step) : requestAnimationFrame(() => step());
  };
  video.play().then(() => { useRVFC ? video.requestVideoFrameCallback(step) : requestAnimationFrame(() => step()); }).catch(() => vcStop());
}
function vcStop() { if (!vc.playing) return; vc.playing = false; video.pause(); setPlay($('vcPlay'), false); }
$('vcSpeed').onchange = () => { if (vc.playing) setRate(+$('vcSpeed').value); };
// Tempo im Menü der Großansicht: tippen schaltet zur nächsten Stufe
const syncSpeedBtn = () => { const sel = $('vcSpeed'); $('vcSpeedBtn').textContent = 'Tempo ' + sel.options[sel.selectedIndex].text; };
$('vcSpeedBtn').onclick = () => { const sel = $('vcSpeed'); sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length; sel.dispatchEvent(new Event('change')); syncSpeedBtn(); };
$('vcSpeed').addEventListener('change', syncSpeedBtn); syncSpeedBtn();
// Marken: beliebig viele Zeitpunkte, die Zeit läuft beim Spulen mit; mit Abstand auch das Tempo je Abschnitt
const realT = (frames) => frames / state.analysisOpts.fps;
function paintJog(i) {
  const mk = state.marks || [], prev = mk.filter((f) => f <= i).pop();
  $('vcJogT').textContent = `${fmt(realT(i), 3)} s` + (prev != null ? `  ·  +${fmt(realT(i - prev), 3)} s seit Marke ${mk.indexOf(prev) + 1}` : '');
}
function renderMarks() {
  const mk = state.marks || (state.marks = []), r = state.result, m = parseNum($('swM').value);
  const tl = $('vcTimeline'); tl.querySelectorAll('.mk').forEach((el) => el.remove());
  mk.forEach((f) => { const d = document.createElement('div'); d.className = 'mk'; d.style.left = (f / r.n * 100) + '%'; tl.appendChild(d); });
  $('mkDel').disabled = !mk.length;
  const tot = mk.length > 1 ? realT(mk[mk.length - 1] - mk[0]) : 0, tMax = Math.max(0, ...mk.slice(1).map((f, k) => realT(f - mk[k])));
  $('swOut').innerHTML = mk.length > 1 ? `<span class="big num">${fmt(tot, 2)} s</span><span class="hint">${mk.length > 2 ? `gesamt über ${mk.length - 1} Abschnitte` : 'zwischen den zwei Marken'}${m > 0 ? ` · ${fmt(m * (mk.length - 1) / tot, 2)} m/s` : ''}</span>` : mk.length === 1 ? '<span class="hint">Marke gesetzt. Beim Spulen läuft ihre Zeit im Bild mit.</span>' : '';
  $('mkList').innerHTML = mk.length > 2 || (mk.length === 2 && m > 0) ? mk.slice(1).map((f, k) => { const t = realT(f - mk[k]); return `<button class="split-row" data-mk="${f}"><b>${k + 1} → ${k + 2}</b><span class="bar"><i style="width:${Math.round(100 * t / tMax)}%"></i></span><span class="tm num">${fmt(t, 2)} s</span><span class="meta">bei ${fmt(realT(f), 2)} s${m > 0 ? ` · ${fmt(m / t, 2)} m/s · ${fmt(m / t * 3.6, 1)} km/h` : ''}</span></button>`; }).join('') : '';
  paintJog(vc.frame || 0);
}
const swTime = () => { const mk = state.marks || []; return mk.length > 1 ? fmt(realT(mk[mk.length - 1] - mk[0]), 2) : ''; };
// „Marke“ schaltet das Setzen ein: danach setzt jeder Tipp aufs Bild eine Marke an dieser Stelle und in diesem Bild
function setMarkArm(on) {
  vc.markArm = on;
  $('mkAdd').textContent = on ? 'Fertig' : 'Marke setzen'; $('mkAdd').classList.toggle('armed', on);
  document.querySelectorAll('[data-proxy="mkAdd"]').forEach((b) => { b.classList.toggle('armed', on); b.setAttribute('aria-label', on ? 'Marken fertig' : 'Marke setzen'); });
  if (on) { $('vcCol').classList.remove('clean'); toast('Tippe im Bild auf die Stelle. Wischen spult weiter.'); }
}
function addMarkAt(e) {
  const cv = $('vcCanvas'), rc = cv.getBoundingClientRect(), i = vc.frame, mk = state.marks || (state.marks = []), pos = state.markPos || (state.markPos = {});
  const vw = !vc.full && vc.views && vc.views[i] ? vc.views[i] : null, cx = (e.clientX - rc.left) / rc.width, cy = (e.clientY - rc.top) / rc.height;
  pos[i] = vw ? { x: (vw.x0 + cx * vw.size) / state.W, y: (vw.y0 + cy * vw.size) / state.H } : { x: cx, y: cy };
  if (!mk.includes(i)) { mk.push(i); mk.sort((a, b) => a - b); }
  renderMarks(); drawVC(i); try { navigator.vibrate && navigator.vibrate(8); } catch {}
}
function drawMarks(ctx, i, nx, ny, W) {
  const mk = state.marks || [], pos = state.markPos || {}; if (!mk.length) return;
  const u = Math.max(9, W / 64); ctx.save(); ctx.font = `700 ${Math.round(u * 1.25)}px -apple-system, system-ui, sans-serif`; ctx.textBaseline = 'middle';
  for (const f of mk) {
    const p = pos[f]; if (!p) continue; const x = nx(p.x), y = ny(p.y), here = f === i, txt = fmt(realT(i - f), 2).replace('-', '−') + ' s'; // jede Marke ist eine eigene Stoppuhr: Zeit seit ihrem Bild
    ctx.globalAlpha = here ? 1 : 0.8;
    ctx.beginPath(); ctx.arc(x, y, u * 0.55, 0, 7); ctx.fillStyle = '#FFD60A'; ctx.fill(); ctx.lineWidth = Math.max(2, u * 0.16); ctx.strokeStyle = '#000'; ctx.stroke();
    const tw = ctx.measureText(txt).width, bw = tw + u * 1.2, bh = u * 1.9, bx = Math.max(2, Math.min(W - bw - 2, x - bw / 2)), by = y - u * 0.9 - bh;
    ctx.fillStyle = here ? '#FFD60A' : 'rgba(20,20,22,.82)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2); else ctx.rect(bx, by, bw, bh); ctx.fill();
    ctx.fillStyle = here ? '#000' : '#fff'; ctx.fillText(txt, bx + u * 0.6, by + bh / 2 + 1);
  }
  ctx.restore();
}
$('mkAdd').onclick = () => setMarkArm(!vc.markArm);
$('mkDel').onclick = () => { const mk = state.marks || []; if (!mk.length) return; const near = mk.reduce((a, b) => (Math.abs(b - vc.frame) < Math.abs(a - vc.frame) ? b : a)); mk.splice(mk.indexOf(near), 1); if (state.markPos) delete state.markPos[near]; renderMarks(); drawVC(vc.frame); toast('Nächstgelegene Marke gelöscht'); };
$('mkList').addEventListener('click', (e) => { const b = e.target.closest('[data-mk]'); if (b) { vcStop(); gotoVC(+b.dataset.mk); } });
$('swM').oninput = renderMarks;
// Leiste zum Spulen: gleiche Logik wie das Wischen auf dem Bild
{ const jog = $('vcJog'), ticks = $('vcJogTicks'); let j = null;
  jog.addEventListener('pointerdown', (e) => { if (!state.result) return; vcStop(); j = { x: e.clientX, f: vc.frame, wf: makeWipe(state.result.n, jog.getBoundingClientRect().width || 300) }; j.wf(e.clientX, e.timeStamp); try { jog.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
  jog.addEventListener('pointermove', (e) => { if (!j) return; ticks.style.transform = `translateX(${(e.clientX - j.x) % 14}px)`; const f = Math.max(0, Math.min(state.result.n - 1, j.f + Math.round(j.wf(e.clientX, e.timeStamp)))); if (f !== vc.frame) gotoVC(f); });
  const end = () => { j = null; ticks.style.transform = ''; }; jog.addEventListener('pointerup', end); jog.addEventListener('pointercancel', end);
}
$('vcLines').onclick = () => { vc.noLines = !vc.noLines; $('vcLines').textContent = vc.noLines ? 'Linien zeigen' : 'Nur Video'; drawVC(vc.frame); };
// Reaktionszeit: Startsignal im Ton suchen, danach die erste Bewegung in den Körperpunkten
function renderRx() {
  const x = state.rx, o = $('rxOut');
  if (!x) { o.innerHTML = ''; return; }
  if (x.busy) { o.innerHTML = '<p class="hint small">Suche das Signal im Ton …</p>'; return; }
  if (x.err) { o.innerHTML = `<div class="notice warn small">${esc(x.err)}</div>`; return; }
  const frameMs = 1000 / state.analysisOpts.fps;
  o.innerHTML = `<div class="swout"><span class="big num">${fmt(x.t, 3)} s</span><span class="hint">auf etwa ±${fmt(Math.max(1, frameMs), 0)} ms genau${x.t < 0.1 || x.t > 0.8 ? ' · unsicher, bitte im Video prüfen' : ''}</span></div>
    <div class="row" style="margin-top:8px"><button class="btn sm grow" data-rx="${x.iS}">Signal zeigen</button><button class="btn sm grow" data-rx="${x.iM}">Erste Bewegung zeigen</button></div>
    <p class="hint small" style="margin:8px 0 0">Der Ton braucht je 10 m bis zur Kamera etwa 0,03 s. Steht die Kamera weit vom Signal, ist die echte Zeit um so viel länger.</p>`;
}
$('rxOut').addEventListener('click', (e) => { const b = e.target.closest('[data-rx]'); if (b) { vcStop(); gotoVC(+b.dataset.rx); } });
$('rxRun').onclick = async () => {
  const r = state.result; if (!r) return;
  state.rx = { busy: true }; renderRx();
  const fail = (err) => { state.rx = { err }; renderRx(); };
  if (!state.file) return fail('Das Video ist nicht mehr geladen. Lade es neu und analysiere noch einmal.');
  if (state.file.size > 500e6) return fail('Die Datei ist für die Tonsuche zu groß.');
  let buf;
  try { const AC = window.AudioContext || window.webkitAudioContext, ac = new AC(); buf = await ac.decodeAudioData(await state.file.arrayBuffer()); try { ac.close(); } catch {} }
  catch { return fail('Im Video ist kein lesbarer Ton. Zeitlupen-Aufnahmen haben oft keinen.'); }
  const sr = buf.sampleRate, ch = buf.getChannelData(0), hop = Math.max(1, Math.round(sr * 0.002));
  const t0 = state.frameTimes[0], t1 = state.frameTimes[r.n - 1], a = Math.max(0, Math.floor(t0 * sr / hop)), b = Math.min(Math.floor(ch.length / hop) - 1, Math.ceil(t1 * sr / hop));
  if (b - a < 50) return fail('Der Ton deckt den Ausschnitt nicht ab.');
  const env = new Float32Array(b - a + 1);
  for (let k = a; k <= b; k++) { let t = 0; for (let q = k * hop, e2 = q + hop; q < e2; q++) t += ch[q] * ch[q]; env[k - a] = Math.sqrt(t / hop); }
  const sorted = Array.from(env).sort((x, y) => x - y), med = sorted[sorted.length >> 1] || 0, peak = sorted[sorted.length - 1] || 0;
  if (!(peak > 0.01) || peak < 4 * med) return fail('Kein deutliches Signal im Ton gefunden.');
  // lautester plötzlicher Anstieg gegenüber den 100 ms davor
  let best = -1, bestV = 0; const W = 50;
  for (let k = W; k < env.length; k++) { let p = 0; for (let q = k - W; q < k; q++) p += env[q]; const v = env[k] - 1.5 * p / W; if (v > bestV) { bestV = v; best = k; } }
  if (best < 0 || env[best] < 0.35 * peak) return fail('Kein deutliches Signal im Ton gefunden.');
  const tS = (best + a) * hop / sr, fileFps = state.fileFps || 30, iS = Math.max(0, Math.min(r.n - 1, Math.round(tS * fileFps - 0.5) - state.i0Frame));
  // Bewegung je Bild: mittlere Verschiebung der Körperpunkte, bezogen auf die Beinlänge
  const F = state.frames, leg = r.legPx || 0.3 * state.H, mv = new Array(r.n).fill(NaN);
  for (let i = 1; i < r.n; i++) { const A = F[i - 1] && F[i - 1].lm, B = F[i] && F[i].lm; if (!A || !B) continue; let t = 0, c = 0; for (let k = 11; k < 33; k++) { const p = A[k], q = B[k]; if (p && q && (p[2] ?? 1) > 0.5 && (q[2] ?? 1) > 0.5) { t += Math.hypot((q[0] - p[0]) * state.W, (q[1] - p[1]) * state.H); c++; } } if (c >= 6) mv[i] = t / c / leg; }
  const base = []; for (let i = Math.max(1, iS - Math.round(0.5 * state.analysisOpts.fps)); i <= iS; i++) if (Number.isFinite(mv[i])) base.push(mv[i]);
  if (base.length < 3) return fail('Vor dem Signal bist du nicht ruhig im Bild zu sehen. Der Ausschnitt muss kurz vor dem Signal beginnen.');
  const mu = base.reduce((x, y) => x + y, 0) / base.length, sd = Math.sqrt(base.reduce((x, y) => x + (y - mu) ** 2, 0) / base.length), thr = mu + Math.max(5 * sd, 0.004);
  let iM = -1; for (let i = iS + 1; i < r.n - 2; i++) if (mv[i] > thr && mv[i + 1] > thr && mv[i + 2] > thr) { iM = i; break; }
  if (iM < 0) return fail('Nach dem Signal ist keine Bewegung zu erkennen.');
  state.rx = { t: (state.frameTimes[iM] - tS) * fileFps / state.analysisOpts.fps, iS, iM }; renderRx();
};

// ======================= Verlauf & Kraft =======================
function lineChart({ xs, series, bands = [], yLabel = '', xLabel = 's', h = 220, marks = [], yMin, yMax, digits = 1 }) {
  const W = 680, H = h, L = 64, R = 14, T = 12, B = 38;
  const all = series.flatMap((s) => s.ys).filter(Number.isFinite);
  if (!all.length) return '<p class="hint small">Keine Daten.</p>';
  let y0 = yMin ?? Math.min(...all), y1 = yMax ?? Math.max(...all); if (y0 === y1) { y0 -= 1; y1 += 1; } const pad = (y1 - y0) * 0.08; if (yMin == null) y0 -= pad; if (yMax == null) y1 += pad;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const sx = (x) => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R), sy = (y) => T + (y1 - y) / (y1 - y0) * (H - T - B);
  let g = '';
  for (const b of bands) g += `<rect x="${sx(b.a)}" y="${T}" width="${Math.max(1, sx(b.b) - sx(b.a))}" height="${H - T - B}" fill="${b.color}" opacity=".13"/>`;
  for (let i = 0; i <= 4; i++) { const yv = y0 + (y1 - y0) * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${sy(yv)}" y2="${sy(yv)}" stroke="var(--sep)"/><text x="${L - 6}" y="${sy(yv) + 4}" text-anchor="end">${fmt(yv, digits)}</text>`; }
  if (xLabel === 's') { for (let i = 0; i <= 5; i++) { const xv = x0 + (x1 - x0) * i / 5; g += `<text x="${sx(xv)}" y="${H - 10}" text-anchor="middle">${fmt(xv, 1)} s</text>`; } }
  else xs.forEach((x) => { g += `<text x="${sx(x)}" y="${H - 10}" text-anchor="middle">${x}</text>`; });
  for (const m of marks) g += `<line x1="${sx(m.x)}" x2="${sx(m.x)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-dasharray="4 4" opacity=".5"/><text x="${sx(m.x) + 4}" y="${T + 10}" style="fill:var(--ink)">${esc(m.label)}</text>`;
  for (const s of series) {
    let d = '', pen = false;
    s.ys.forEach((y, i) => { if (!Number.isFinite(y)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2.5}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 5"' : ''}/>`;
    if (s.dots) s.ys.forEach((y, i) => { if (Number.isFinite(y)) g += `<circle cx="${sx(xs[i])}" cy="${sy(y)}" r="4.5" fill="${(s.dotColors && s.dotColors[i]) || s.color}"/>`; });
  }
  const leg = series.filter((s) => s.label).map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><i style="width:14px;height:3px;border-radius:2px;background:${s.color};display:inline-block"></i>${esc(s.label)}</span>`).join('');
  return `${leg ? `<div class="hint small" style="margin:4px 0">${leg}</div>` : ''}<div class="hint small" style="margin:2px 0 0">${esc(yLabel)}</div><svg class="chart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg>`;
}
const SIDECOL = { L: '#E4572E', R: '#2E86DE' };
function lrTableHtml(lr) {
  const keys = ['contactMs', 'flightMs', 'touchdownCm', 'kneeLiftDeg', 'hipExtTO', 'vGain', 'fMean', 'stepLenM'].filter((k) => lr[k]);
  if (!keys.length) return '<p class="hint small">Zu wenige Schritte je Seite.</p>';
  return `<table><tr><th class="l">Kennzahl</th><th style="color:${SIDECOL.L}">links</th><th style="color:${SIDECOL.R}">rechts</th><th>Unterschied</th></tr>${keys.map((k) => { const m = M(k), x = lr[k], big = Math.abs(x.asymPct) > 10; const absOnly = ['vGain', 'vBrake'].includes(k) || (Math.abs(x.L) + Math.abs(x.R)) / 2 < 0.05; const d = x.R - x.L; return `<tr><td class="l">${esc(shortLabel(k))}</td><td class="num">${fmt(x.L, m.digits)}</td><td class="num">${fmt(x.R, m.digits)}</td><td class="num ${!absOnly && big ? 't-near' : ''}">${absOnly ? `${d > 0 ? '+' : ''}${fmt(d, m.digits)} ${esc(m.unit)}` : `${x.asymPct > 0 ? '+' : ''}${fmt(x.asymPct)} %`}</td></tr>`; }).join('')}</table><p class="hint small">Unterschied = rechts gegenüber links. Ab etwa 10 % lohnt ein genauer Blick.</p>`;
}
function touchdownHtml(tds) {
  const ints = tds.slice(1).map((t, i) => t - tds[i]);
  return `<div class="hint small">${tds.map((t, i) => `H${i + 1}: <b class="num">${fmt(t, 2)}</b>`).join(', ')}</div>${ints.length ? lineChart({ xs: ints.map((_, i) => i + 1), series: [{ ys: ints, color: 'var(--track)', dots: true }], yLabel: 'Sekunden zwischen den Hürden', xLabel: 'Abschnitt', h: 170, digits: 2 }) : ''}`;
}
function renderCurves() {
  const r = state.result; if (!r) return;
  const c = r.curves, o = state.analysisOpts;
  $('curvesNote').innerHTML = !c || !c.ok ? '<div class="notice warn">Für den Verlauf wird ein Maßstab gebraucht – Körpergröße eintragen.</div>' : o.fps < 100 ? `<div class="notice">Bei ${o.fps} fps sind die Kurven grob, besonders die Kraft. Mit Zeitlupe (120/240 fps) werden sie deutlich genauer.</div>` : '';
  if (!c || !c.ok) return;
  const sc = speedCurve(r, hSpaceFor(r));
  $('curvesNote').innerHTML += sc.source === 'hurdles' ? `<div class="notice">Tempo auf den Hürdenabstand (${fmt(hSpaceFor(r), 2)} m) geeicht: Die Strecke von Hürde zu Hürde stimmt, egal wie weit weg oder wie schräg gefilmt wurde.</div>` : '<div class="notice">Tempo nur aus dem Bild geschätzt. Es stimmt, wenn genau von der Seite gefilmt ist. Mit zwei erkannten Hürden und dem Hürdenabstand wird es geeicht.</div>';
  const stp = Math.max(1, Math.floor(c.t.length / 400)), idx = c.t.map((_, i) => i).filter((i) => i % stp === 0);
  const bands = r.contacts.map((k) => ({ a: k.i0 / r.fps, b: k.i1 / r.fps, color: SIDECOL[k.side] }));
  $('chartV').innerHTML = lineChart({ xs: idx.map((i) => c.t[i]), series: [{ ys: idx.map((i) => sc.v[i]), color: 'var(--track)' }], bands, yLabel: 'm/s', digits: 1 });
  $('chartF').innerHTML = lineChart({ xs: idx.map((i) => c.t[i]), series: [{ ys: idx.map((i) => (Number.isFinite(c.f[i]) ? Math.max(-0.5, Math.min(6, c.f[i])) : NaN)), color: 'var(--info)' }, { ys: idx.map(() => 1), color: 'var(--muted)', w: 1, dash: true }], bands, yLabel: 'Körpergewichte (gestrichelt = 1, Stehen)', digits: 1 });
  const st = r.steps.filter((x) => x.include);
  const bar = (key, title, digits) => {
    const vals = st.map((x) => x[key]).filter(Number.isFinite); if (!vals.length) return '';
    const mx = Math.max(...vals.map(Math.abs), 1e-6);
    return `<h3>${esc(title)}</h3><div style="display:flex;align-items:flex-end;gap:6px;height:130px;padding:0 2px">${st.map((x) => { const v = x[key]; const hgt = Number.isFinite(v) ? Math.max(4, Math.abs(v) / mx * 100) : 0; return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><span class="num" style="color:var(--muted);font-size:11px">${fmt(v, digits)}</span><div title="Schritt ${x.index}" style="width:100%;max-width:38px;height:${hgt}px;border-radius:8px 8px 4px 4px;background:${SIDECOL[x.side]};opacity:${v < 0 ? 0.45 : 0.9}"></div><span style="color:var(--muted);font-size:11px">${x.index}</span></div>`; }).join('')}</div>`;
  };
  const lr = summarizeLR(r);
  const sideAvg = (k, thr) => { if (!lr[k]) return ''; const d = lr[k].R - lr[k].L; return `<p class="small" style="margin:8px 0 0">Mittel <span style="color:${SIDECOL.L}">links</span> ${fmt(lr[k].L, 2)}, <span style="color:${SIDECOL.R}">rechts</span> ${fmt(lr[k].R, 2)}${Math.abs(d) > thr ? ` <span class="t-near">– ${d > 0 ? 'rechts' : 'links'} deutlich stärker</span>` : ' – ausgeglichen'}</p>`; };
  $('lrBars').innerHTML = `<p class="hint small">Jeder Balken ist ein Stütz (rot links, blau rechts). Tempogewinn = wie viel schneller du nach dem Abdruck bist als beim Aufsetzen. Das sind Schätzungen aus dem Video – aussagekräftig ist vor allem der Vergleich der Seiten und deiner Läufe.</p>` + bar('vGain', 'Tempogewinn pro Stütz (m/s)', 2) + sideAvg('vGain', 0.15) + bar('fMean', 'Mittlere Vertikalkraft im Stütz (× Körpergewicht)', 1) + sideAvg('fMean', 0.15);
  $('lrTable').innerHTML = `<h3>Alle Werte nach Seite</h3>${lrTableHtml(lr)}`;
  const tr = transitionStep(r);
  $('transNote').textContent = tr ? `Ab Schritt ${tr} ist die Flugzeit länger als die Kontaktzeit – der Übergang von der Beschleunigung ins aufrechte Laufen.` : 'In diesem Ausschnitt ist die Kontaktzeit überall länger als die Flugzeit – du bist noch in der Beschleunigung.';
  const xs = st.map((x) => x.index), dc = st.map((x) => SIDECOL[x.side]);
  const mk = tr ? [{ x: tr, label: 'Übergang' }] : [];
  if (xs.length < 2) { $('chartSteps').innerHTML = '<p class="hint small">Zu wenige Schritte für einen Verlauf.</p>'; $('chartLen').innerHTML = ''; $('chartAng').innerHTML = ''; }
  else {
    $('chartSteps').innerHTML = `<h3>Kontakt- und Flugzeit</h3>` + lineChart({ xs, series: [{ ys: st.map((x) => x.contactMs), color: 'var(--track)', dots: true, dotColors: dc, label: 'Kontakt (ms)' }, { ys: st.map((x) => x.flightMs), color: 'var(--info)', dots: true, label: 'Flug (ms)' }], xLabel: 'Schritt', h: 200, marks: mk, digits: 0 });
    const lens = st.map((x) => x.stepLenM), fr = st.map((x) => x.cadenceHz);
    $('chartLen').innerHTML = lens.some(Number.isFinite) ? `<h3>Schrittlänge (m)</h3>` + lineChart({ xs, series: [{ ys: lens, color: 'var(--good)', dots: true, dotColors: dc }], xLabel: 'Schritt', h: 170, marks: mk, digits: 2 }) : `<h3>Schrittfrequenz (Schritte/s)</h3>` + lineChart({ xs, series: [{ ys: fr, color: 'var(--good)', dots: true, dotColors: dc }], xLabel: 'Schritt', h: 170, marks: mk, digits: 2 });
    $('chartAng').innerHTML = `<h3>Haltung (°)</h3>` + lineChart({ xs, series: [{ ys: st.map((x) => x.shinTD), color: 'var(--near)', dots: true, label: 'Unterschenkel beim Aufsetzen' }, { ys: st.map((x) => x.bodyLeanTO), color: 'var(--track)', dots: true, label: 'Körpervorlage beim Abdruck' }], xLabel: 'Schritt', h: 190, marks: mk, digits: 0 });
  }
  const rh = r.rhythm; $('rhythmCard').hidden = !(rh && rh.clearances.length);
  if (rh && rh.clearances.length) $('rhythmBody').innerHTML = `<p class="small" style="margin-top:0">Erkannte Überquerungen (lange Flugphase): ${rh.clearances.map((x) => `nach Schritt ${x.step} (Absprung ${x.takeoffSide === 'L' ? 'links' : 'rechts'}, Flug ${fmt(x.flightMs)} ms)`).join('; ')}.</p>${rh.between.length ? `<p class="small">Bodenkontakte zwischen den Hürden: <b class="num">${rh.between.join(', ')}</b>. Ungerade Zahl = gleiches Schwungbein, gerade Zahl = Wechsel.</p>` : '<p class="hint small">Für den Rhythmus zwischen Hürden müssen mindestens zwei Überquerungen im Video sein, z. B. mit mitschwenkender Kamera.</p>'}`;
}

// ======================= Kinogramm =======================
// Fünf Schlüsselbilder. Laufschritt nach ALTIS (Abdruck, höchster Punkt, Strike, Aufsetzen, volle Stütze),
// Hürde: Angriff, Absprung, über der Hürde, Landung, weg von der Hürde. Jedes Bild lässt sich um einzelne Bilder verschieben.
const kino = { mode: 'run', step: null, hurdle: null, off: [0, 0, 0, 0, 0], skel: true, sel: 0 };
let kinoStep = null; // für ältere Aufrufe
const KINO_TXT = {
  'Abdruck': 'Fuß verlässt den Boden', 'Höchster Punkt': 'Hüfte am höchsten im Flug', 'Strike': 'Schwungbein ganz vorne, bevor es zurückschlägt',
  'Aufsetzen': 'erster Bodenkontakt', 'Volle Stütze': 'Fuß unter der Hüfte', 'Vorletzter Schritt': 'vorletzter Kontakt vor der Hürde', 'Letzter Schritt': 'letzter Kontakt vor dem Absprung setzt auf',
  'Absprung': 'Absprungbein verlässt den Boden', 'Über der Hürde': 'Hüfte über der Hürde', 'Landung': 'erster Kontakt hinter der Hürde', 'Weg von der Hürde': 'Abdruck aus der Landung',
};
function kinoCandidates() { const st = state.result.steps; return st.map((x, k) => ({ x, k })).filter(({ x, k }) => x.include && !x.hurdleStep && st[k + 1] && !st[k + 1].hurdleStep && Number.isFinite(x.iMVP) && Number.isFinite(x.iStrike)); }
function kinoHurdles() { return (state.result.hurdles || []).filter((h) => h.found); }
function kinoShots() {
  const r = state.result;
  if (kino.mode === 'hurdle') {
    const h = kinoHurdles().find((x) => x.nr === kino.hurdle); if (!h) return null;
    const to = r.contacts.find((c) => c.i1 === h.takeoffIndex), ld = r.contacts.find((c) => c.i0 === h.landingIndex);
    if (!to || !ld) return null;
    const pv = r.contacts[r.contacts.indexOf(to) - 1];
    const sh = [['Vorletzter Schritt', pv ? pv.i0 : Math.max(0, to.i0 - 6), pv ? pv.side : null], ['Letzter Schritt', to.i0, to.side], ['Absprung', to.i1, to.side], ['Über der Hürde', h.crossIndex, null], ['Landung', ld.i0, ld.side]];
    sh.sort((a, b) => a[1] - b[1]);
    return { title: `Hürde ${h.nr}`, shots: sh };
  }
  const k = kino.step; const a = r.steps[k], b = r.steps[k + 1]; if (!a || !b) return null;
  return { title: `Schritt ${a.index} → ${b.index}`, shots: [['Abdruck', a.i1, a.side], ['Höchster Punkt', a.iMVP, null], ['Strike', a.iStrike, null], ['Aufsetzen', b.i0, b.side], ['Volle Stütze', b.iMid ?? b.i0, b.side]] };
}
function setupKino() {
  const cands = kinoCandidates(), hs = kinoHurdles();
  $('kinoMode').hidden = !hs.length; if (!hs.length) kino.mode = 'run';
  kinoModeSeg.set(kino.mode);
  if (kino.step == null || !cands.find((c) => c.k === kino.step)) kino.step = cands.length ? cands[Math.floor((cands.length - 1) / 2)].k : null;
  if (kino.hurdle == null || !hs.find((h) => h.nr === kino.hurdle)) kino.hurdle = hs.length ? hs[0].nr : null;
  kinoStep = kino.step;
  $('kinoSteps').innerHTML = kino.mode === 'hurdle'
    ? hs.map((h) => `<button class="chip ${h.nr === kino.hurdle ? 'on' : ''}" data-h="${h.nr}">Hürde ${h.nr}</button>`).join('')
    : cands.map(({ x, k }) => `<button class="chip ${k === kino.step ? 'on' : ''}" data-k="${k}">Schritt ${x.index} ${x.side === 'L' ? 'links' : 'rechts'}</button>`).join('');
  $('kinoImg').style.display = 'none';
  if (!kinoShots()) { $('kinoAdj').innerHTML = ''; $('kinoInfo').textContent = kino.mode === 'hurdle' ? 'Keine vollständig erkannte Hürdenüberquerung.' : 'Für ein Kinogramm braucht es zwei aufeinanderfolgende, vollständig erkannte Laufschritte.'; const c = $('kinoCanvas'); c.width = 10; c.height = 10; return; }
  renderKinogram($('kinoCanvas'));
}
const kinoModeSeg = initSeg($('kinoMode'), (v) => { kino.mode = v; kino.off = [0, 0, 0, 0, 0]; setupKino(); });
$('kinoSteps').addEventListener('click', (e) => { const b = e.target.closest('[data-k],[data-h]'); if (!b) return; if (b.dataset.k != null) kino.step = +b.dataset.k; else kino.hurdle = +b.dataset.h; kino.off = [0, 0, 0, 0, 0]; setupKino(); });
$('kinoAdj').addEventListener('click', (e) => {
  const p = e.target.closest('[data-pick]'); if (p) { kino.sel = +p.dataset.pick; renderKinogram($('kinoCanvas')); return; }
  const b = e.target.closest('[data-j]'); if (!b) return; kino.off[+b.dataset.j] += +b.dataset.d; renderKinogram($('kinoCanvas'));
});
$('kinoCanvas').addEventListener('click', (e) => { const r = e.target.getBoundingClientRect(); kino.sel = Math.max(0, Math.min(4, Math.floor((e.clientX - r.left) / r.width * 5))); renderKinogram($('kinoCanvas')); });
$('kinoSkel').addEventListener('change', (e) => { kino.skel = e.target.checked; renderKinogram($('kinoCanvas')); });
$('kinoReset').onclick = () => { kino.off = [0, 0, 0, 0, 0]; renderKinogram($('kinoCanvas')); };
let kinoBusy = 0;
async function renderKinogram(canvas, thumbH) {
  const r = state.result;
  if (kino.step == null) { const c = kinoCandidates(); if (c.length) kino.step = c[Math.floor((c.length - 1) / 2)].k; }
  const def = kinoShots(); if (!def) return null;
  const tok = ++kinoBusy;
  const shots = def.shots.map(([l, i, sd], j) => [l, Math.max(0, Math.min(r.n - 1, Math.round(i) + (kino.off[j] || 0))), sd]);
  const box = shots.map(([, i]) => { const pts = r.smoothed.map((arr) => arr[i]).filter(Boolean).map((p) => unrot(p, i)); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return pts.length ? { cx: (Math.min(...xs) + Math.max(...xs)) / 2, y0: Math.min(...ys), y1: Math.max(...ys) } : { cx: state.W / 2, y0: 0, y1: state.H }; });
  // Ausschnitt je Bild an die Körpergröße in diesem Bild anpassen (wichtig, wenn die Kamera zoomt)
  const crops = box.map((q) => { const ch = Math.min(state.H, Math.max(40, q.y1 - q.y0) * 1.3); return { ch, cw: Math.min(state.W, ch * 0.62) }; });
  const ph = thumbH || 640, pw = Math.round(ph * 0.62), gapPx = Math.round(ph * 0.025);
  const cv = canvas || document.createElement('canvas'); const W2 = pw * 5 + gapPx * 4, H2 = ph + Math.round(ph * 0.12);
  const off = document.createElement('canvas'); off.width = W2; off.height = H2;
  const dark = true;
  const ctx = off.getContext('2d'); ctx.fillStyle = '#101216'; ctx.fillRect(0, 0, W2, H2);
  for (let j = 0; j < 5; j++) {
    const [label, i, side] = shots[j]; await seekTo(state.frameTimes[i]); if (tok !== kinoBusy) return null;
    const q = box[j], { ch, cw } = crops[j]; const sx = Math.max(0, Math.min(state.W - cw, q.cx - cw / 2)), sy = Math.max(0, Math.min(state.H - ch, (q.y0 + q.y1) / 2 - ch / 2));
    const ox = j * (pw + gapPx);
    ctx.save(); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(ox, 0, pw, ph, Math.round(ph * 0.035)); else ctx.rect(ox, 0, pw, ph); ctx.clip();
    ctx.drawImage(video, sx, sy, cw, ch, ox, 0, pw, ph);
    if (kino.skel) { const lm = r.smoothed.map((arr) => { if (!arr[i]) return null; const p = unrot(arr[i], i); return [(p[0] - sx) / cw, (p[1] - sy) / ch, 1]; }); ctx.translate(ox, 0); drawPose(ctx, lm, pw, ph, { contactSide: side, alpha: 0.85 }); }
    ctx.restore();
    if (!thumbH && j === (kino.sel ?? 0)) { ctx.save(); ctx.strokeStyle = '#FF5A2E'; ctx.lineWidth = Math.max(3, ph * 0.012); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(ox + 2, 2, pw - 4, ph - 4, Math.round(ph * 0.035)); else ctx.rect(ox + 2, 2, pw - 4, ph - 4); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = dark ? '#e9eef5' : '#14233a'; ctx.font = `650 ${Math.max(9, Math.round(ph * 0.05))}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = 'center';
    ctx.fillText(label, ox + pw / 2, ph + Math.round(ph * 0.085)); ctx.textAlign = 'left';
  }
  if (thumbH) { try { return off.toDataURL('image/jpeg', 0.7); } catch { return null; } }
  cv.width = W2; cv.height = H2; cv.getContext('2d').drawImage(off, 0, 0);
  { const big = $('kinoBig'), j = Math.max(0, Math.min(4, kino.sel ?? 0)); big.width = pw; big.height = H2; big.getContext('2d').drawImage(off, j * (pw + gapPx), 0, pw, H2, 0, 0, pw, H2); }
  $('kinoInfo').textContent = def.title;
  kino.sel = Math.max(0, Math.min(4, kino.sel ?? 0));
  const [sl, si] = shots[kino.sel];
  $('kinoAdj').innerHTML = `<div class="kpick">${shots.map(([l], j) => `<button class="${j === kino.sel ? 'on' : ''}" data-pick="${j}"><span>${j + 1}</span>${esc(l)}${kino.off[j] ? ` <small>${kino.off[j] > 0 ? '+' : ''}${kino.off[j]}</small>` : ''}</button>`).join('')}</div>
    <div class="knudge"><div class="hint small" style="margin-bottom:8px"><b>Bild ${kino.sel + 1}: ${esc(sl)}</b> – ${esc(KINO_TXT[sl] || '')}. Passt der Moment nicht genau, verschiebe ihn:</div>
    <div class="row"><button class="btn tint grow" data-j="${kino.sel}" data-d="-1">‹ 1 Bild früher</button><button class="btn tint grow" data-j="${kino.sel}" data-d="1">1 Bild später ›</button></div></div>`;
  return null;
}
$('kinoSave').onclick = async () => {
  const cv = $('kinoCanvas'); let url; try { url = cv.toDataURL('image/png'); } catch { toast('Bild konnte nicht erstellt werden'); return; }
  let dl = null; try { dl = window.claude && (await window.claude.use('downloads')); } catch {}
  if (dl) { try { const blob = await new Promise((res) => cv.toBlob(res, 'image/png')); await dl.save({ filename: `kinogramm-${today()}.png`, data: blob, mimeType: 'image/png' }); return; } catch {} }
  const img = $('kinoImg'); img.src = url; img.style.display = 'block'; toast('Bild unten gedrückt halten bzw. Rechtsklick › Speichern');
};

// ======================= Figur =======================
let player = null;
function setupFigure() {
  const st = state.result && state.result.stride;
  if (!st) { $('figInfo').textContent = 'Für die Figur braucht es mindestens einen vollständig erkannten Doppelschritt.'; const c = $('figCanvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); return; }
  if (!player) {
    player = new FigurePlayer($('figCanvas'), { onFrame: (t, items) => { $('figSlider').value = Math.round(t * 1000); const it = items[0]; const c = it.stride.contacts.find((c) => t >= c.a && t <= c.b); $('figInfo').textContent = `${fmt(t * it.stride.durationMs)} von ${fmt(it.stride.durationMs)} ms, ${c ? 'Bodenkontakt ' + (c.side === 'L' ? 'links' : 'rechts') : 'Flugphase'}`; } });
    $('figPlay').onclick = () => { setPlay($('figPlay'), player.toggle()); };
    $('figSpeed').onchange = () => { player.speed = +$('figSpeed').value; };
    $('figSlider').oninput = () => { player.pause(); setPlay($('figPlay'), false); player.seek(+$('figSlider').value / 1000); };
  }
  player.speed = +$('figSpeed').value; player.set([{ stride: st }]);
}

// ======================= Speichern =======================
async function makeThumb(result, frames, times) {
  const c = result.contacts[Math.floor(result.contacts.length / 2)], i = c ? c.i0 : Math.floor(frames.length / 2);
  await seekTo(times[i]);
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = Math.round(200 * state.H / state.W);
  const ctx = cv.getContext('2d'); ctx.drawImage(video, 0, 0, cv.width, cv.height);
  const lm = result.smoothed.map((a) => { if (!a[i]) return null; const q = unrot(a[i], i, result); return [q[0] / state.W, q[1] / state.H, 1]; });
  drawPose(ctx, lm, cv.width, cv.height, { contactSide: c && c.side });
  try { return cv.toDataURL('image/jpeg', 0.6); } catch { return null; }
}
function buildRun({ id, result, opts, phase, file, thumb, date, label, timeS, note }) {
  const sum = summarize(result);
  return {
    id: id || uid(), v: 2, createdAt: Date.now(), date: date || today(), label: label || '', timeS: timeS ?? null, note: note || '',
    mode: opts.mode, camera: opts.camera, fps: opts.fps, heightCm: opts.heightCm, fileName: file ? file.name : '', phase,
    tiltDeg: round(result.tilt * 180 / Math.PI, 1), stride: result.stride || null, summary: cleanObj(sum, 3),
    steps: result.steps.map((s) => cleanObj({ index: s.index, side: s.side, include: s.include, partial: s.partial, hurdleRole: s.hurdleRole || null, contactMs: s.contactMs, flightMs: s.flightMs, touchdownCm: s.touchdownCm, bodyLeanTO: s.bodyLeanTO, kneeLiftDeg: s.kneeLiftDeg, hipExtTO: s.hipExtTO, trunkDeg: s.trunkDeg, confidence: s.confidence, flags: s.flags || [] }, 3)),
    hints: hints(sum, opts.mode, phase).map((h) => h.text), quality: cleanObj(result.quality, 1), thumb,
    lr: Object.fromEntries(Object.entries(summarizeLR(result)).map(([k, v]) => [k, cleanObj(v, 2)])), transition: transitionStep(result),
    rhythm: result.rhythm || null, scaleSource: result.scaleSource,
    hurdles: (result.hurdles || []).map((h) => cleanObj({ nr: h.nr, found: h.found, auto: !!h.auto, reason: h.reason || null, warn: h.warn || null, takeoffSide: h.takeoffSide || null, ...Object.fromEntries(HURDLE_METRICS.map((m) => [m.key, h[m.key]])) }, 2)),
    stepSeries: result.steps.filter((x) => x.include).map((x) => cleanObj({ i: x.index, side: x.side, c: x.contactMs, f: x.flightMs, l: x.stepLenM, g: x.vGain, fm: x.fMean }, 3)),
  };
}
$('openSave').onclick = () => {
  openSheet(`<h2>Lauf speichern</h2><div class="stack">
    <label class="f">Strecke oder Übung<input id="sv-label" list="labelList" placeholder="z. B. 30 m fliegend" value="${esc(state.lastLabel || '')}"></label>
    <div class="row"><label class="f">Zeit in s<input id="sv-time" inputmode="decimal" placeholder="optional, z. B. 3,12" value="${swTime()}"></label><label class="f">Datum<input id="sv-date" type="date" value="${today()}"></label></div>
    ${state.analysisOpts && state.analysisOpts.mode === 'hurdle' ? '<label class="f">Touchdown-Zeiten (optional, mit Leerzeichen getrennt)<input id="sv-td" placeholder="z. B. 6,1 10,0 14,1"></label>' : ''}
    <label class="f">Notiz<textarea id="sv-note" placeholder="Wind, Spikes, Müdigkeit …"></textarea></label>
    <p class="hint small" style="margin:0">Die Zeit kannst du auch später unter „Läufe“ ergänzen. Benutze für gleiche Strecken immer dieselbe Bezeichnung – dann funktioniert die Auswertung.</p></div>
    <div class="foot"><button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button></div>`, (el) => {
    el.querySelector('[data-no]').onclick = () => closeSheet(false);
    el.querySelector('[data-yes]').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const run = buildRun({ id: state.savedId, result: state.result, opts: state.analysisOpts, phase: state.resPhase, file: state.file, thumb: await makeThumb(state.result, state.frames, state.frameTimes), date: el.querySelector('#sv-date').value, label: el.querySelector('#sv-label').value.trim(), timeS: parseNum(el.querySelector('#sv-time').value), note: el.querySelector('#sv-note').value.trim() });
        const tdIn = el.querySelector('#sv-td'); if (tdIn && tdIn.value.trim()) run.touchdowns = tdIn.value.trim().split(/[\s;]+/).map(parseNum).filter((x) => x != null);
        try { run.kino = await renderKinogram(null, 70); } catch {}
        await saveRun(run); state.savedId = run.id; state.dirty = false; state.lastLabel = run.label; $('openSave').textContent = 'Gespeichert ✓'; closeSheet(true); toast(store.mode === 'cloud' ? 'Gespeichert' : 'Gespeichert in diesem Browser');
      } catch (e) { ev.target.disabled = false; toast('Speichern fehlgeschlagen: ' + (e.message || e.code)); }
    };
  });
};
$('newBtn').onclick = () => $('backBtn').click();

// ======================= Läufe =======================
let selecting = false, picked = [], filterLabel = '';
$('selectBtn').onclick = () => { selecting = !selecting; picked = []; $('selectBtn').textContent = selecting ? 'Fertig' : 'Vergleichen'; renderRuns(); };
function renderRuns() {
  const labels = [...new Set(store.runs.map((r) => r.label).filter(Boolean))];
  $('labelFilter').innerHTML = labels.length > 1 ? [`<button class="chip ${!filterLabel ? 'on' : ''}" data-l="">Alle</button>`, ...labels.map((l) => `<button class="chip ${filterLabel === l ? 'on' : ''}" data-l="${esc(l)}">${esc(l)}</button>`)].join('') : '';
  $('selectHint').textContent = selecting ? `Wähle zwei Läufe zum Vergleichen (${picked.length}/2).` : 'Deine gespeicherten Analysen.';
  const runs = store.runs.filter((r) => !filterLabel || r.label === filterLabel);
  $('runList').classList.toggle('selecting', selecting);
  $('runList').innerHTML = runs.length ? runs.map((r) => `<div class="run ${picked.includes(r.id) ? 'picked' : ''}" data-id="${esc(r.id)}">
      ${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '<div class="ph"></div>'}
      <div><div class="t">${esc(r.label || 'Ohne Bezeichnung')}</div><div class="m">${esc(dateDE(r.date))}${r.phase ? ', ' + esc(phaseName(r.phase)) : ''}${r.mode === 'hurdle' ? ', Hürde' : ''}</div></div>
      <div style="display:flex;align-items:center;gap:10px"><span class="tm">${r.timeS != null ? fmt(r.timeS, 2) + ' s' : '<span class="hint small">ohne Zeit</span>'}</span><span class="sel">✓</span></div></div>`).join('')
    : `<div class="empty"><b>${store.mode === 'connecting' ? 'Lade …' : 'Noch keine Läufe'}</b>${store.mode === 'connecting' ? '' : 'Analysiere ein Video und tippe auf „Lauf speichern“.'}</div>`;
}
$('labelFilter').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; filterLabel = b.dataset.l; renderRuns(); };
$('runList').onclick = (e) => {
  const row = e.target.closest('.run'); if (!row) return; const id = row.dataset.id;
  if (selecting) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2); renderRuns();
    if (picked.length === 2) openCompare(picked.map((x) => store.runs.find((r) => r.id === x)));
    return;
  }
  openRun(store.runs.find((r) => r.id === id));
};
function openRun(r) {
  if (!r) return; const s = r.summary || {}, phase = r.phase || 'maxv';
  const cats = CATEGORIES.map((c) => { const keys = c.keys.filter((k) => Number.isFinite(s[k])); if (!keys.length) return ''; return `<div class="list" style="margin:12px 0;box-shadow:none;background:var(--card2)"><div class="area-h"><span class="dot d-${areaStats(c, s, phase).status}"></span><h3>${esc(c.label)}</h3></div>${keys.map((k) => metricRow(k, s, phase)).join('')}</div>`; }).join('');
  openSheet(`<h2>${esc(r.label || 'Lauf')}</h2><p class="hint" style="margin-top:-6px">${esc(dateDE(r.date))}, ${esc(phaseName(phase))}${r.fileName ? ', ' + esc(r.fileName) : ''}</p>
    <div class="stack"><div class="row"><label class="f">Zeit in s<input data-f="timeS" inputmode="decimal" value="${r.timeS != null ? String(r.timeS).replace('.', ',') : ''}"></label><label class="f">Datum<input data-f="date" type="date" value="${esc(r.date)}"></label></div>
    <label class="f">Strecke<input data-f="label" list="labelList" value="${esc(r.label)}"></label><label class="f">Notiz<textarea data-f="note">${esc(r.note)}</textarea></label></div>
    <div class="foot"><button class="btn" data-del style="color:var(--off)">Löschen</button><button class="btn primary" data-save>Änderungen sichern</button></div>
    ${r.kino ? `<img src="${esc(r.kino)}" alt="Kinogramm" style="width:100%;border-radius:12px;margin:12px 0 4px"><p class="hint small" style="margin:0">Kinogramm</p>` : ''}
    ${r.lr && Object.keys(r.lr).length ? `<div class="list" style="margin:12px 0;box-shadow:none;background:var(--card2)"><div class="area-h"><h3>Links gegen rechts</h3></div><div style="padding:0 16px 10px">${lrTableHtml(r.lr)}</div></div>` : ''}
    ${r.touchdowns && r.touchdowns.length ? `<div class="list" style="margin:12px 0;box-shadow:none;background:var(--card2)"><div class="area-h"><h3>Touchdown-Zeiten</h3></div><div style="padding:8px 16px 12px">${touchdownHtml(r.touchdowns)}</div></div>` : ''}
    ${cats}<p class="hint small">${s.steps ?? '?'} Schritte, ${r.fps} fps, ${r.heightCm} cm${Number.isFinite(r.tiltDeg) && r.tiltDeg ? `, Neigung ${fmt(r.tiltDeg, 1)}° ausgeglichen` : ''}</p>`, (el) => {
    const get = (f) => el.querySelector(`[data-f="${f}"]`).value;
    el.querySelector('[data-save]').onclick = async () => { try { await updateRun(r.id, { timeS: parseNum(get('timeS')), label: get('label').trim(), date: get('date'), note: get('note').trim() }); closeSheet(true); toast('Gesichert'); } catch (e) { toast('Fehler: ' + (e.message || e.code)); } };
    el.querySelector('[data-del]').onclick = async () => { closeSheet(false); if (await confirmSheet('Lauf löschen?', 'Der Lauf und alle Messwerte werden endgültig gelöscht.', 'Löschen', true)) { try { await deleteRun(r.id); toast('Gelöscht'); } catch (e) { toast('Fehler: ' + (e.message || e.code)); } } };
  });
}

// ---------- Vergleich ----------
let cmpPlayer = null;
function openCompare(runs) {
  const [A, B] = runs; if (!A || !B) return;
  const phase = A.phase || B.phase || 'maxv', sA = A.summary || {}, sB = B.summary || {};
  const closer = (k) => { const r = REF[phase] && REF[phase][k]; if (!r) return ''; const d = (v) => (!Number.isFinite(v) ? Infinity : v < r.lo ? r.lo - v : v > r.hi ? v - r.hi : 0); const a = d(sA[k]), b = d(sB[k]); if (Math.abs(a - b) < 0.1 * (r.hi - r.lo) || (a === Infinity && b === Infinity)) return ''; return a < b ? 'A' : 'B'; };
  const rows = CATEGORIES.map((c) => { const ks = c.keys.filter((k) => Number.isFinite(sA[k]) || Number.isFinite(sB[k])); if (!ks.length) return ''; return `<tr><th class="l" colspan="4" style="padding-top:16px;color:var(--ink)">${esc(c.label)}</th></tr>` + ks.map((k) => { const m = M(k), w = closer(k), r = REF[phase] && REF[phase][k]; return `<tr><td class="l">${esc(shortLabel(k))}${r ? `<br><span class="hint small">${r.lo}–${r.hi} ${esc(m.unit)}</span>` : ''}</td><td class="num ${w === 'A' ? 't-good' : ''}">${fmt(sA[k], m.digits)}</td><td class="num ${w === 'B' ? 't-good' : ''}">${fmt(sB[k], m.digits)}</td><td class="num">${Number.isFinite(sA[k]) && Number.isFinite(sB[k]) ? ((sB[k] - sA[k] > 0 ? '+' : '') + fmt(sB[k] - sA[k], m.digits)) : '–'}</td></tr>`; }).join(''); }).join('');
  const nm = (r) => `${esc(r.label || r.fileName || 'Lauf')}<br><span class="hint small">${esc(dateDE(r.date))}${r.timeS != null ? ', ' + fmt(r.timeS, 2) + ' s' : ''}</span>`;
  const fig = A.stride && B.stride;
  openSheet(`<h2>Vergleich</h2><div class="row" style="margin-bottom:12px"><div class="grow"><span class="cmpA">A</span> ${nm(A)}</div><div class="grow"><span class="cmpB">B</span> ${nm(B)}</div></div>
    ${fig ? `<div class="figwrap" style="box-shadow:none;background:var(--card2)"><canvas width="1000" height="460"></canvas></div><div class="transport"><button class="tbtn play" data-play aria-label="Abspielen">${IC.play}</button><input type="range" data-scrub min="0" max="1000" value="0"><select data-speed style="width:auto;padding:8px 10px"><option value="0.1">0,1×</option><option value="0.25" selected>0,25×</option><option value="0.5">0,5×</option><option value="1">1×</option></select></div><p class="hint small">Beide Figuren übereinander, synchron ab dem Aufsetzen. <span class="cmpA">A</span> rot, <span class="cmpB">B</span> blau.</p>` : '<p class="hint small">Die Figuren lassen sich nur vergleichen, wenn bei beiden Läufen ein vollständiger Doppelschritt erkannt wurde.</p>'}
    <div class="tablewrap"><table><tr><th class="l">Richtwerte ${esc(phaseName(phase))}</th><th class="cmpA">A</th><th class="cmpB">B</th><th>B − A</th></tr>${rows}</table></div><p class="hint small">Grün = näher am Richtbereich.</p>
    <div class="foot"><button class="btn block" data-close>Schließen</button></div>`, (el) => {
    el.querySelector('[data-close]').onclick = () => closeSheet(false);
    if (fig) {
      cmpPlayer = new FigurePlayer(el.querySelector('canvas'), { onFrame: (t) => { el.querySelector('[data-scrub]').value = Math.round(t * 1000); } });
      cmpPlayer.set([{ stride: B.stride, color: '#2E86DE' }, { stride: A.stride, color: '#C2362B' }]); cmpPlayer.speed = 0.25;
      el.querySelector('[data-play]').onclick = (e) => { setPlay(e.currentTarget, cmpPlayer.toggle()); };
      el.querySelector('[data-speed]').onchange = (e) => { cmpPlayer.speed = +e.target.value; };
      el.querySelector('[data-scrub]').oninput = (e) => { cmpPlayer.pause(); cmpPlayer.seek(+e.target.value / 1000); };
    }
  }).then(() => { if (selecting) { picked = []; renderRuns(); } });
}

// ---------- Export / Import ----------
async function offerFile(filename, data, mime) {
  let dl = null; try { dl = window.claude && (await window.claude.use('downloads')); } catch {}
  if (dl) { try { await dl.save({ filename, data, mimeType: mime }); return; } catch {} }
  const box = $('exportBox'); box.hidden = false; box.value = data; if (!$('v-laeufe').classList.contains('on')) showView('laeufe'); box.select();
  $('exportMsg').innerHTML = '<div class="notice">Download nicht möglich – der Inhalt steht unten. <button class="btn sm tint" id="copyExp">Kopieren</button></div>';
  $('copyExp').onclick = async () => { try { await navigator.clipboard.writeText(data); toast('Kopiert'); } catch { box.select(); } };
}
$('expJson').onclick = () => offerFile(`sprint-analyse-${today()}.json`, JSON.stringify({ app: 'sprint-analyse', v: 2, runs: store.runs }, null, 1), 'application/json');
$('expCsv').onclick = () => {
  const keys = METRICS.map((m) => m.key).concat(HURDLE_METRICS.map((m) => 'h_' + m.key));
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"', num = (v) => (Number.isFinite(v) ? String(v).replace('.', ',') : '');
  const head = ['Datum', 'Strecke', 'Zeit_s', 'Phase', 'Disziplin', 'fps', 'Schritte', ...METRICS.map((m) => `${m.label} [${m.unit}]`), ...HURDLE_METRICS.map((m) => `${m.label} [${m.unit}]`), 'Notiz'];
  const rows = store.runs.map((r) => [r.date, q(r.label), num(r.timeS), q(phaseName(r.phase)), r.mode, r.fps, r.summary?.steps ?? '', ...keys.map((k) => num(r.summary?.[k])), q(r.note)].join(';'));
  offerFile(`sprint-analyse-${today()}.csv`, '﻿' + [head.map(q).join(';'), ...rows].join('\n'), 'text/csv');
};
$('impJson').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const d = JSON.parse(await f.text()); const runs = Array.isArray(d) ? d : d.runs; if (!Array.isArray(runs)) throw new Error('keine Läufe in der Datei'); let n = 0; for (const r of runs) { if (!r || !r.id || !r.summary || store.runs.some((x) => x.id === r.id)) continue; await saveRun(r); n++; } toast(`${n} Läufe importiert`); }
  catch (err) { toast('Import fehlgeschlagen: ' + err.message); }
});
$('migrateBtn').onclick = async () => { const local = localRead(LOCAL_KEY, []); let n = 0; for (const r of local) if (!store.runs.some((x) => x.id === r.id)) { await saveRun(r); n++; } try { localStorage.removeItem(LOCAL_KEY); } catch {} toast(`${n} Läufe übernommen`); setStoreInfo(); };

// ======================= Stapelanalyse =======================
const batch = { items: [], running: false, mode: 'sprint', phase: 'auto', camera: 'pan', sel: [] };
initSeg($('bMode'), (v) => { batch.mode = v; }); initSeg($('bPhase'), (v) => { batch.phase = v; }); initSeg($('bCam'), (v) => { batch.camera = v; });
function startBatch(files) {
  batch.items = files.map((f) => ({ file: f, status: 'bereit' })); batch.sel = [];
  $('bHeight').value = store.profile.heightCm || $('height').value || 180; $('bDate').value = $('bDate').value || today(); $('bActions').hidden = true;
  showScreen('s-batch'); renderBatch();
}
function renderBatch() {
  $('bList').innerHTML = batch.items.map((it, i) => {
    const s = it.summary;
    return `<div class="li" style="cursor:default;align-items:flex-start" data-i="${i}"><div class="grow"><b style="word-break:break-all">${esc(it.file.name)}</b><div class="hint small" data-status>${esc(it.status)}${it.phase ? ', ' + esc(phaseName(it.phase)) : ''}</div>
      ${s ? `<div class="hint small" style="margin-top:4px">Kontakt <span class="num">${fmt(s.contactMs)}</span> ms, Aufsetzen <span class="num">${fmt(s.touchdownCm)}</span> cm, Vorlage <span class="num">${fmt(s.bodyLeanTO)}</span>°</div>
      <div class="row" style="margin-top:8px;align-items:center"><input data-bt="${i}" style="width:110px;padding:8px 10px" value="${it.timeS != null ? String(it.timeS).replace('.', ',') : ''}" inputmode="decimal" placeholder="Zeit s"><button class="btn sm tint" data-open="${i}">Öffnen</button><label class="hint small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-sel="${i}" ${batch.sel.includes(i) ? 'checked' : ''}> vergleichen</label>${it.savedId ? '<span class="t-good small">gespeichert</span>' : ''}</div>` : ''}</div></div>`;
  }).join('');
  $('bCompare').disabled = batch.sel.length !== 2;
}
$('bList').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.bt != null) batch.items[+t.dataset.bt].timeS = parseNum(t.value);
  if (t.dataset.sel != null) { const i = +t.dataset.sel; batch.sel = t.checked ? [...batch.sel.filter((x) => x !== i), i].slice(-2) : batch.sel.filter((x) => x !== i); renderBatch(); }
});
$('bList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-open]'); if (!b) return; const it = batch.items[+b.dataset.open];
  await openVideo(it.file);
  Object.assign(state, { frames: it.frames, frameTimes: it.times, i0Frame: 0, result: it.result, analysisOpts: it.opts, phase: it.phase });
  finishResult(false); state.resPhase = it.phase; renderResult();
});
$('bCancel').onclick = () => { if (batch.running) state.cancel = true; else showScreen('s-pick'); };
$('bRun').onclick = async () => {
  if (batch.running) return; batch.running = true; state.cancel = false; $('bRun').disabled = true;
  const height = parseNum($('bHeight').value) || 180; saveProfile({ heightCm: height });
  let lmk; try { lmk = await getLandmarker(); } catch (e) { toast('Modell konnte nicht geladen werden'); batch.running = false; $('bRun').disabled = false; return; }
  for (const it of batch.items) {
    if (state.cancel) break; if (it.result) continue;
    const setS = (t) => { it.status = t; const el = $('bList').querySelector(`[data-i="${batch.items.indexOf(it)}"] [data-status]`); if (el) el.textContent = t; };
    try {
      setS('lädt …'); await openVideo(it.file);
      const fileFps = state.fileFps, nAll = Math.floor(state.duration * fileFps), n = Math.min(6000, nAll);
      const { frames, times } = await detectFrames(lmk, 0, n, fileFps, null, null, null, (t) => setS(t));
      if (state.cancel) { setS('abgebrochen'); break; }
      const fps = $('bFps').value === 'file' ? fileFps : +$('bFps').value;
      const opts = { fps, W: state.W, H: state.H, heightCm: height, camera: batch.camera, mode: batch.mode, hurdle: null, laneLine: null };
      const result = analyze(frames, opts), sum = summarize(result);
      result.stride = extractStride(result); if (result.stride) result.stride.speed = sum.speedMs || null;
      Object.assign(it, { frames, times, result, opts, summary: sum, phase: batch.phase === 'auto' ? suggestPhase(sum) : batch.phase });
      it.thumb = await makeThumb(result, frames, times);
      it.status = `fertig, ${sum.steps} Schritte${nAll > 6000 ? ', nur die ersten 6000 Bilder' : ''}`;
    } catch (e) { it.status = 'Fehler: ' + (e.message || e); }
    renderBatch();
  }
  batch.running = false; $('bRun').disabled = false; $('bActions').hidden = !batch.items.some((x) => x.result);
};
const batchRun = (it) => buildRun({ id: it.savedId, result: it.result, opts: it.opts, phase: it.phase, file: it.file, thumb: it.thumb, date: $('bDate').value, label: $('bLabel').value.trim(), timeS: it.timeS });
$('bSaveAll').onclick = async () => {
  let n = 0; $('bSaveAll').disabled = true;
  try { for (const it of batch.items) { if (!it.result) continue; const run = batchRun(it); await saveRun(run); it.savedId = run.id; n++; } toast(`${n} Läufe gespeichert`); }
  catch (e) { toast('Fehler: ' + (e.message || e.code)); }
  $('bSaveAll').disabled = false; renderBatch();
};
$('bCompare').onclick = () => { if (batch.sel.length === 2) openCompare(batch.sel.map((i) => { const r = batchRun(batch.items[i]); r.label = r.label || batch.items[i].file.name; return r; })); };

// ======================= Auswertung =======================
let anaLabel = '', anaMetric = '';
const allMetrics = () => METRICS.map((m) => ({ ...m, k: m.key })).concat(HURDLE_METRICS.map((m) => ({ ...m, k: 'h_' + m.key })));
const STEP_UNIT = { ms: 10, cm: 5, '°': 5, 'Schritte/s': 0.1, m: 0.1, 'm/s': 0.5, '%': 2 };
function renderAnalysis() {
  const withTime = store.runs.filter((r) => r.timeS != null && r.label);
  const labels = [...new Set(withTime.map((r) => r.label))];
  if (!labels.includes(anaLabel)) anaLabel = labels[0] || '';
  $('anaLabels').innerHTML = labels.map((l) => `<button class="chip ${l === anaLabel ? 'on' : ''}" data-l="${esc(l)}">${esc(l)}</button>`).join('');
  const body = $('anaBody');
  if (!labels.length) { body.innerHTML = '<div class="card empty"><b>Noch keine Läufe mit Zeit</b>Trag bei gespeicherten Läufen die gestoppte Zeit ein (Läufe › Lauf antippen). Ab etwa fünf Läufen pro Strecke zeigt sich hier, was bei dir mit schnellen Zeiten zusammenhängt.</div>'; return; }
  const runs = withTime.filter((r) => r.label === anaLabel).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const rows = allMetrics().filter((m) => runs.filter((r) => Number.isFinite(r.summary?.[m.k])).length >= 2).map((m) => ({ m, ...correlate(runs.map((r) => r.summary?.[m.k]), runs.map((r) => r.timeS)) })).sort((a, b) => (Math.abs(b.r) || 0) - (Math.abs(a.r) || 0));
  if (!rows.find((x) => x.m.k === anaMetric)) anaMetric = (rows.find((x) => Number.isFinite(x.r)) || rows[0] || { m: {} }).m.k;
  const times = runs.map((r) => r.timeS), best = Math.min(...times), avg = times.reduce((a, b) => a + b, 0) / times.length;
  const dist = parseNum((anaLabel.match(/(\d+[.,]?\d*)\s*m\b/) || [])[1]);
  let h = `<div class="keys" style="margin-bottom:14px"><div class="key"><div class="l">Läufe mit Zeit</div><div class="v">${runs.length}</div></div><div class="key"><div class="l">Bestzeit</div><div class="v t-good">${fmt(best, 2)}<small>s</small></div></div><div class="key"><div class="l">Schnitt</div><div class="v">${fmt(avg, 2)}<small>s</small></div></div>${dist ? `<div class="key"><div class="l">Bestes Tempo</div><div class="v">${fmt(dist / best, 2)}<small>m/s</small></div></div>` : ''}</div>`;
  if (runs.length < 4) h += `<div class="notice warn">Erst ${runs.length} Läufe mit Zeit. Zusammenhänge werden ab etwa fünf Läufen aussagekräftig.</div>`;
  const m = allMetrics().find((x) => x.k === anaMetric);
  if (m) { const pts = runs.map((r) => ({ x: r.summary?.[m.k], y: r.timeS, r })).filter((p) => Number.isFinite(p.x)); h += `<div class="card"><h2 style="font-size:17px">${esc(m.label)} und Zeit</h2>${scatterSvg(pts, m)}</div>`; }
  h += `<div class="list"><div class="area-h"><h3>Zusammenhang mit der Zeit</h3></div><div style="padding:0 16px"><p class="hint small">r reicht von −1 bis +1. Positiv heißt: höherer Wert, langsamere Zeit. Negativ: höherer Wert, schnellere Zeit. Ein Zusammenhang ist kein Beweis für eine Ursache.</p></div>`;
  for (const x of rows) {
    const strength = !Number.isFinite(x.r) ? '' : Math.abs(x.r) >= 0.6 ? 'stark' : Math.abs(x.r) >= 0.3 ? 'mittel' : 'schwach';
    const su = STEP_UNIT[x.m.unit] || 1;
    const mean = Number.isFinite(x.slope) && x.n >= 4 && Math.abs(x.r) >= 0.3 ? `+${fmt(su, su < 1 ? 1 : 0)} ${x.m.unit} ≈ ${x.slope * su > 0 ? '+' : '−'}${fmt(Math.abs(x.slope * su), 2)} s` : x.n < 4 ? 'zu wenige Läufe' : '';
    h += `<div class="mrow" data-k="${x.m.k}" style="${x.m.k === anaMetric ? 'background:var(--card2)' : ''}"><div class="top2"><span class="nm">${esc(x.m.label.split(' (')[0])}</span><span class="val ${x.r > 0.3 ? 't-off' : x.r < -0.3 ? 't-good' : ''}">${fmt(x.r, 2)}</span></div><div class="hint small">${strength}${strength && mean ? ', ' : ''}${esc(mean)} (n = ${x.n})</div></div>`;
  }
  body.innerHTML = h + '</div>';
}
$('anaLabels').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; anaLabel = b.dataset.l; anaMetric = ''; renderAnalysis(); };
$('anaBody').onclick = (e) => { const r = e.target.closest('[data-k]'); if (!r) return; anaMetric = r.dataset.k; renderAnalysis(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
function scatterSvg(pts, m) {
  if (pts.length < 2) return '<p class="hint">Mindestens zwei Läufe mit diesem Wert nötig.</p>';
  const W = 640, H = 300, L = 50, R = 14, T = 12, B = 40;
  const nice = (a, b) => { if (a === b) { a -= 1; b += 1; } const p = (b - a) * 0.12; return [a - p, b + p]; };
  const [x0, x1] = nice(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))), [y0, y1] = nice(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)));
  const sx = (x) => L + (x - x0) / (x1 - x0) * (W - L - R), sy = (y) => T + (y1 - y) / (y1 - y0) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 4; i++) { const yv = y0 + (y1 - y0) * i / 4, xv = x0 + (x1 - x0) * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${sy(yv)}" y2="${sy(yv)}" stroke="var(--sep)"/><text x="${L - 6}" y="${sy(yv) + 4}" text-anchor="end">${fmt(yv, 2)}</text><text x="${sx(xv)}" y="${H - B + 18}" text-anchor="middle">${fmt(xv, m.digits)}</text>`; }
  const c = correlate(pts.map((p) => p.x), pts.map((p) => p.y));
  if (Number.isFinite(c.slope)) g += `<line x1="${sx(x0)}" y1="${sy(c.intercept + c.slope * x0)}" x2="${sx(x1)}" y2="${sy(c.intercept + c.slope * x1)}" stroke="var(--track)" stroke-width="2" stroke-dasharray="6 5" opacity=".7"/>`;
  for (const p of pts) g += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="7" fill="var(--track)" stroke="var(--card)" stroke-width="2"><title>${esc(dateDE(p.r.date))}: ${fmt(p.y, 2)} s</title></circle>`;
  g += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(m.unit)}</text><text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Zeit in s (unten = schneller)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg>`;
}

// ======================= Start =======================
$('bDate').value = today();
setStoreInfo(); initStore();
{ const v = location.hash.slice(1); if (VIEWS.includes(v)) showView(v); }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && !$('v-' + v).classList.contains('on') && !fsOn) showView(v); });
[['vPlay', 0], ['vcPlay', 0], ['edPlay', 0], ['figPlay', 0]].forEach(([id]) => setPlay($(id), false));
if (location.hash === '#selbsttest') (async () => {
  showView('hilfe'); const box = document.createElement('div'); box.className = 'notice'; box.textContent = 'Selbsttest läuft …'; document.querySelector('#v-hilfe').prepend(box);
  try { const t0 = performance.now(); const l = await getLandmarker((t) => { box.textContent = t; }); const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').fillRect(0, 0, 320, 240); const r = l.detectForVideo(c, 1); box.textContent = `Selbsttest OK – Modell in ${((performance.now() - t0) / 1000).toFixed(1)} s geladen, Erkennung läuft (${r.landmarks.length} Personen im Testbild). Speicher: ${store.mode}.`; }
  catch (e) { box.className = 'notice err'; box.textContent = 'Selbsttest FEHLER: ' + (e && (e.message || e)); }
})();
window.__sprint = { state, store, analyze, renderResult, finishResult, saveRun, openCheck, showScreen, autoTune, runAnalyze, keepRunner, renderRunners, snapRunner };
