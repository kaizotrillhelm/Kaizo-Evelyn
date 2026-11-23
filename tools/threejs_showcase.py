"""threejs_showcase.py - turn the three.js benchmark into code files and side-by-side GIFs.

  python tools/threejs_showcase.py --three-dir <folder with three.module.js and three.core.js>

Reads tests/tmp/threejs_bench_results.json (written by js/test/evelyn_threejs_bench.js), then
  1. writes every final code to examples/threejs/<task>/<condition>_run<k>.js, the model's reply unchanged under a short comment,
     and the numbers without the code to examples/threejs/bench_results.json;
  2. draws each scene in a headless Brave with SOFTWARE rendering (SwiftShader: no graphics card is used) and writes
     media/threejs/<task>_run<k>.gif with Inkling alone on the left and Inkling with Evelyn (loop with notes) on the right.

What the drawing changes about a scene: the canvas is 384 x 216 and the camera's aspect is set to match; Math.random is replaced by
a seeded generator so the picture is repeatable; the island scene does not move, so for it (and only it) the camera circles the
origin once. The page carries a content-security policy that blocks every network request from the model's code.
The GIFs are not looked at by this tool: it reports file sizes and the page's own errors, nothing else. Python 3, Playwright, Pillow, ffmpeg."""
import argparse
import http.server
import json
import os
import shutil
import subprocess
import tempfile
import threading
import base64
import io

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BRAVE = r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
TASKS = {
    'cube': 'Spinning cube',
    'solar': 'Solar system',
    'island': 'Low-poly island with instanced trees',
}
CONDS = {
    'alone': ('inkling_alone', 'Inkling alone'),
    'loop': ('evelyn_loop', 'Inkling + Evelyn (loop, no notes)'),
    'notes': ('evelyn_notes', 'Inkling + Evelyn (loop with notes)'),
}
W, H, FPS, N = 384, 216, 10, 60

HARNESS = """<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src data: blob:">
<canvas id="c"></canvas>
<script type="module">
import * as THREE from '/three/three.module.js';
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
window.renderScene = function (code, o) {
  Math.random = mulberry32(o.seed);
  var canvas = document.getElementById('c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(o.w, o.h, false);
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x15161c);
  var r;
  try { r = new Function('THREE', code + '\\n;return buildScene(THREE);')(THREE); } catch (e) { return { error: 'buildScene threw: ' + e.message }; }
  var cam = r.camera;
  cam.aspect = o.w / o.h; cam.updateProjectionMatrix();
  var base = cam.position.clone(), frames = [], i;
  try {
    for (i = 0; i < o.n; i++) {
      r.update(i / o.fps);
      if (o.orbit) {
        var a = 2 * Math.PI * i / o.n, c = Math.cos(a), s = Math.sin(a);
        cam.position.set(base.x * c + base.z * s, base.y, -base.x * s + base.z * c); cam.lookAt(0, 0, 0);
      }
      renderer.render(r.scene, cam);
      frames.push(canvas.toDataURL('image/png'));
    }
  } catch (e2) { return { error: 'drawing threw at frame ' + i + ': ' + e2.message }; }
  return { frames: frames };
};
window.__ready = true;
</script>"""


def font(size):
    for f in ('C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def serve(three_dir, tmp):
    with open(os.path.join(tmp, 'harness.html'), 'w', encoding='utf8') as f:
        f.write(HARNESS)

    class H(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            path = path.split('?', 1)[0]
            if path.startswith('/three/'):
                return os.path.join(three_dir, path[len('/three/'):])
            return os.path.join(tmp, path.lstrip('/'))

        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def export(results, out_dir):
    for r in results:
        if not r.get('code'):
            continue
        label = CONDS[r['cond']][1]
        verdict = 'passes all checks' if r['ok'] else 'FAILS the checks: ' + str((r.get('errors') or ['?'])[0])
        head = ('// Written by Inkling 2 Mini (Q4_K_M) for the task "%s".\n'
                '// Condition: %s. Seed %d. Run %d of 2.\n'
                '// The checks of js/test/three_verify_worker.js: %s.\n'
                '// Everything below this comment is the model\'s code, unchanged.\n\n') % (TASKS[r['task']], label, r['seed'], r['trial'] + 1, verdict)
        d = os.path.join(out_dir, r['task'])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, '%s_run%d.js' % (CONDS[r['cond']][0], r['trial'] + 1)), 'w', encoding='utf8', newline='\n') as f:
            f.write(head + r['code'].rstrip('\n') + '\n')
    slim = [{k: v for k, v in r.items() if k != 'code'} for r in results]
    with open(os.path.join(out_dir, 'bench_results.json'), 'w', encoding='utf8', newline='\n') as f:
        json.dump({'note': 'js/test/evelyn_threejs_bench.js, Inkling 2 Mini Q4_K_M, 2026-11-23; code is in the other files of this folder', 'results': slim}, f, indent=1)


def draw(page, base, code, task, seed):
    page.goto(base + '/harness.html')
    page.wait_for_function('window.__ready === true', timeout=20000)
    out = page.evaluate('([c, o]) => window.renderScene(c, o)', [code, dict(w=W, h=H, fps=FPS, n=N, seed=seed, orbit=(task == 'island'))])
    if out.get('error'):
        return None, out['error']
    frames = [Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1]))).convert('RGB') for u in out['frames']]
    return frames, None


def panel_frames(frames, label, sub, ok, msg=None):
    """a panel: label strip, the picture (or a message when there is none), a result line"""
    fl, fs = font(13), font(11)
    n = len(frames) if frames else N
    out = []
    for i in range(n):
        im = Image.new('RGB', (W, H + 44), (24, 25, 32))
        d = ImageDraw.Draw(im)
        d.text((8, 4), label, font=fl, fill=(235, 235, 240))
        d.text((8, 22), sub, font=fs, fill=(150, 152, 165))
        if frames:
            im.paste(frames[i], (0, 40))
        else:
            d.rectangle([0, 40, W, 40 + H], fill=(40, 30, 32))
            y = 40 + H // 2 - 22
            for line in (msg or '').split('\n'):
                d.text((W // 2 - d.textlength(line, font=fl) / 2, y), line, font=fl, fill=(235, 190, 190))
                y += 20
        d.text((8, H + 44 - 18 + 2), 'passes all checks' if ok else 'fails the checks', font=fl, fill=(120, 220, 140) if ok else (240, 120, 120))
        out.append(im)
    return out


def write_gif(frames, path):
    tmp = tempfile.mkdtemp()
    try:
        for i, f in enumerate(frames):
            f.save(os.path.join(tmp, 'f%03d.png' % i))
        pal = os.path.join(tmp, 'pal.png')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(tmp, 'f%03d.png'), '-vf', 'palettegen=stats_mode=diff', pal], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(tmp, 'f%03d.png'), '-i', pal, '-lavfi',
                        'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', path], check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--three-dir', required=True)
    ap.add_argument('--results', default=os.path.join(ROOT, 'tests', 'tmp', 'threejs_bench_results.json'))
    ap.add_argument('--examples', default=os.path.join(ROOT, 'examples', 'threejs'))
    ap.add_argument('--media', default=os.path.join(ROOT, 'media', 'threejs'))
    a = ap.parse_args()
    results = json.load(open(a.results, encoding='utf8'))['results']
    export(results, a.examples)
    os.makedirs(a.media, exist_ok=True)
    by = {(r['task'], r['trial'], r['cond']): r for r in results}

    tmp = tempfile.mkdtemp()
    srv = serve(os.path.abspath(a.three_dir), tmp)
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    page_errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=BRAVE, headless=True,
                                  args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            for task in TASKS:
                for trial in (0, 1):
                    panels = []
                    for cond in ('alone', 'notes'):
                        r = by[(task, trial, cond)]
                        frames, err = (None, None)
                        msg = None
                        if r.get('code'):
                            pg = b.new_page(viewport={'width': 420, 'height': 260})
                            pg.on('pageerror', lambda e, t=task, c=cond: page_errors.append('%s/%s page error: %s' % (t, c, e)))
                            frames, err = draw(pg, base, r['code'], task, r['seed'])
                            pg.close()
                            if err:
                                page_errors.append('%s/%s: %s' % (task, cond, err))
                                msg = 'the code could not be drawn:\n' + err[:44]
                        else:
                            msg = 'No code: the model used its 6,000 tokens\nthinking and never finished the answer'
                        label = CONDS[cond][1]
                        sub = 'run %d, %d call%s, %d tokens' % (trial + 1, r['calls'], '' if r['calls'] == 1 else 's', r['tokens'])
                        panels.append(panel_frames(frames, label, sub, r['ok'], msg))
                    both = []
                    for i in range(N):
                        im = Image.new('RGB', (W * 2 + 6, H + 44), (10, 10, 14))
                        im.paste(panels[0][i % len(panels[0])], (0, 0))
                        im.paste(panels[1][i % len(panels[1])], (W + 6, 0))
                        both.append(im)
                    path = os.path.join(a.media, '%s_run%d.gif' % (task, trial + 1))
                    write_gif(both, path)
                    print('%-14s %6.0f KB  %d frames' % (os.path.basename(path), os.path.getsize(path) / 1024, len(both)))
            b.close()
    finally:
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    if page_errors:
        print('PAGE PROBLEMS:')
        for e in page_errors:
            print('  ' + e)
    else:
        print('no page errors')


if __name__ == '__main__':
    main()
