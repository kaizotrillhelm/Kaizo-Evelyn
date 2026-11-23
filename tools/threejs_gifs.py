"""threejs_gifs.py - GIFs of every three.js scene that evelyn_skills_bench.js wrote.

  python tools/threejs_gifs.py --three-dir <folder with three.module.js and three.core.js> --bench tests/tmp/skills_bench/llama --media media/skills_bench/llama

Reads <bench>/results.json and <bench>/code/three/<task>/<cond>_run<k>.js and writes, under --media:
  single/<task>_<cond>_run<k>.gif   one scene, one condition
  grid/<task>_run<k>.gif            every condition of that task and run side by side (alone, loop, notes, skill, skillcal)
The drawing is the one of tools/threejs_showcase.py: a headless Brave with SOFTWARE rendering (SwiftShader, no graphics card is used),
a 384 x 216 canvas, a seeded Math.random, a content-security policy that blocks every network request from the model's code, and for the
island (which does not move) one turn of the camera. The GIFs are not looked at by this tool: it reports file sizes and the page's own errors.
Python 3, Playwright, Pillow, ffmpeg."""
import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import threejs_showcase as ts  # noqa: E402
from PIL import Image  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

CONDS = [
    ('alone', 'Inkling alone'),
    ('loop', 'Loop, notes off'),
    ('notes', 'Loop, notes on'),
    ('skill', 'Loop + skill'),
    ('skillcal', 'Loop + skill + Caldera'),
]
COLS = 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--three-dir', required=True)
    ap.add_argument('--bench', required=True)
    ap.add_argument('--media', required=True)
    a = ap.parse_args()
    data = json.load(open(os.path.join(a.bench, 'results.json'), encoding='utf8'))
    results = [r for r in data['results'] if r['suite'] in ('three', 'photo')]
    by = {(r['task'], r['trial'], r['cond']): r for r in results}
    os.makedirs(os.path.join(a.media, 'single'), exist_ok=True)
    os.makedirs(os.path.join(a.media, 'grid'), exist_ok=True)

    tmp = tempfile.mkdtemp()
    srv = ts.serve(os.path.abspath(a.three_dir), tmp)
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    problems = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=ts.BRAVE, headless=True,
                                  args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            tasks = sorted({r['task'] for r in results})
            for task in tasks:
                for trial in sorted({r['trial'] for r in results if r['task'] == task}):
                    panels = []
                    for cond, label in CONDS:
                        r = by.get((task, trial, cond))
                        if not r:
                            continue
                        codefile = os.path.join(a.bench, 'code', 'photo' if task == 'photo' else 'three', task, '%s_run%d.js' % (cond, trial + 1))
                        frames, msg = None, None
                        if os.path.exists(codefile):
                            pg = b.new_page(viewport={'width': 420, 'height': 260})
                            pg.on('pageerror', lambda e, t=task, c=cond: problems.append('%s/%s page error: %s' % (t, c, e)))
                            frames, err = ts.draw(pg, base, open(codefile, encoding='utf8').read(), task, r['seed'])
                            pg.close()
                            if err:
                                problems.append('%s/%s run %d: %s' % (task, cond, trial + 1, err))
                                msg = 'the code could not be drawn:\n' + err[:44]
                        else:
                            msg = 'No code: the model never finished\nan answer within its token limit'
                        sk = ('+'.join(r.get('activeSkills') or [])) or ''
                        sub = 'run %d, %d call%s, %d tok%s' % (trial + 1, r['calls'], '' if r['calls'] == 1 else 's', r['tokens'], (', ' + sk) if sk else '')
                        pf = ts.panel_frames(frames, label, sub[:58], r['ok'], msg)
                        panels.append(pf)
                        ts.write_gif(pf, os.path.join(a.media, 'single', '%s_%s_run%d.gif' % (task, cond, trial + 1)))
                    if not panels:
                        continue
                    rows = (len(panels) + COLS - 1) // COLS
                    pw, ph = panels[0][0].size
                    both = []
                    for i in range(ts.N):
                        im = Image.new('RGB', (pw * COLS + 6 * (COLS - 1), ph * rows + 6 * (rows - 1)), (10, 10, 14))
                        for k, pf in enumerate(panels):
                            im.paste(pf[i % len(pf)], ((k % COLS) * (pw + 6), (k // COLS) * (ph + 6)))
                        both.append(im)
                    path = os.path.join(a.media, 'grid', '%s_run%d.gif' % (task, trial + 1))
                    ts.write_gif(both, path)
                    print('%-22s %6.0f KB  %d panels' % (os.path.basename(path), os.path.getsize(path) / 1024, len(panels)))
            b.close()
    finally:
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    print('PAGE PROBLEMS:' if problems else 'no page errors')
    for e in problems:
        print('  ' + e)


if __name__ == '__main__':
    main()
