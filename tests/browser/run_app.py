"""Echte App-Pipeline im Headless-Chrome laufen lassen und den Diagnose-Export (v2) speichern.

Aufruf:
  python3 tests/browser/run_app.py VIDEO.mp4 --fps 60 --tap 3.5 0.60 0.55 --out tests/data/lauf.diag.json [--camera pan]

Das Video muss H.264 sein (Chrome unter Linux spielt kein HEVC):
  ffmpeg -i IMG.mov -an -c:v libx264 -crf 16 -pix_fmt yuv420p -r 60 IMG.mp4
"""
import argparse, functools, http.server, json, os, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

def serve(port):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('--out', required=True)
    ap.add_argument('--fps', type=float, required=True)
    ap.add_argument('--tap', nargs=3, type=float, metavar=('T', 'X', 'Y'), help='Person antippen: Zeit in s, x und y normiert')
    ap.add_argument('--start', type=float, default=0); ap.add_argument('--end', type=float, default=None)
    ap.add_argument('--camera', default='pan', choices=['pan', 'fixed'])
    ap.add_argument('--height', type=float, default=180)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--chrome', default='/usr/bin/google-chrome')
    a = ap.parse_args()
    serve(a.port)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=a.chrome, headless=True, args=['--autoplay-policy=no-user-gesture-required', '--mute-audio'])
        pg = br.new_page(viewport={'width': 1200, 'height': 900})
        pg.on('pageerror', lambda e: print('pageerror:', e))
        pg.goto(f'http://127.0.0.1:{a.port}/index.html')
        pg.wait_for_function('window.__sprint && window.__sprint.state')
        pg.set_input_files('#file', a.video)
        pg.wait_for_function('window.__sprint.state.duration > 0', timeout=60000)
        time.sleep(4)  # automatische Ausschnittsuche abwarten, danach überschreiben wir sie
        pg.evaluate("""([a]) => { const s = window.__sprint.state;
            s.fileFps = a.fps; const sel = document.getElementById('fps');
            if (![...sel.options].some((o) => +o.value === a.fps)) sel.add(new Option(String(a.fps), String(a.fps)));
            sel.value = String(a.fps); document.getElementById('height').value = String(a.height);
            s.camera = a.camera; s.start = a.start; s.end = a.end ?? s.duration;
            s.personPt = a.tap ? { x: a.tap[1], y: a.tap[2] } : null; s.personT = a.tap ? a.tap[0] : null; s.personPose = null; }""", [vars(a)])
        t0 = time.time()
        pg.evaluate('window.__sprint.runAnalysis().catch((e) => { window.__runErr = String(e); })')
        pg.wait_for_function('window.__runErr || (window.__sprint.state.result && !document.getElementById("s-progress").classList.contains("on"))', timeout=30 * 60 * 1000, polling=1000)
        err = pg.evaluate('window.__runErr || null')
        if err: raise SystemExit('Analyse fehlgeschlagen: ' + err)
        secs = time.time() - t0
        pg.evaluate("document.getElementById('diagBtn').click()")
        data = json.loads(pg.eval_on_selector('#exportBox', 'e => e.value'))
        data['harness'] = {'video': os.path.basename(a.video), 'tap': a.tap, 'camera': a.camera, 'seconds': round(secs, 1)}
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'w') as f: json.dump(data, f)
        print(f'fertig in {secs:.0f} s, {sum(1 for x in data["frames"] if x)} von {len(data["frames"])} Bildern mit Pose, {len(data["contacts"])} Kontakte -> {a.out}')
        br.close()

if __name__ == '__main__':
    main()
