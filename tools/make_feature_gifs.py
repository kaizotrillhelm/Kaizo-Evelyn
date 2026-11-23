"""make_feature_gifs.py - two GIFs made in real Brave from the real pages.
   python tools/make_feature_gifs.py [face|features|both]
   media/evelyn_face_float.gif   10.0 s: the CRT portrait, drawn by Evelyn's own code (EvelynArt.drawEvelynPortrait) one frame at a time,
                                  floating gently; the mood changes idle, thinking, talking, happy, idle. The float and the stars are added
                                  by this script around the real portrait.
   media/evelyn_features.gif     the cartridge player, the rule validator, the parent read-out, the glass-box debugger, the safety charter,
                                  MiniSQL and the module status list, all clicked through the real concourse page.
   Needs playwright (Python) and Pillow. Starts its own loopback server on neon/."""
import os, sys, io, time, math, socket, threading, functools, http.server
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NEON = os.path.join(ROOT, "neon")
MEDIA = os.path.join(ROOT, "media")
BRAVE = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
mode = sys.argv[1] if len(sys.argv) > 1 else "both"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=NEON))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d/" % port

def save_gif(frames, name, colors, outw=None):
    imgs = []
    for im, ms in frames:
        if outw and im.width != outw: im = im.resize((outw, int(im.height * outw / im.width)), Image.LANCZOS)
        imgs.append(im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    os.makedirs(MEDIA, exist_ok=True)
    out = os.path.join(MEDIA, name)
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=[f[1] for f in frames], loop=0, optimize=True, disposal=1)
    print(name, "frames", len(frames), "seconds %.1f" % (sum(f[1] for f in frames) / 1000.0), "bytes", os.path.getsize(out))

FACE_PAGE = """
document.body.style.cssText = 'margin:0;background:radial-gradient(ellipse at 50% 45%,#12104a 0%,#080826 55%,#04041c 100%);overflow:hidden;width:480px;height:480px;position:relative;font-family:Consolas,monospace';
var stars = [];
for (var i = 0; i < 46; i++) { var d = document.createElement('div'); var x = (i * 97 % 480), y = (i * 53 % 470); d.style.cssText = 'position:absolute;left:'+x+'px;top:'+y+'px;width:2px;height:2px;background:#9fe8ff'; document.body.appendChild(d); stars.push([d, i]); }
var shadow = document.createElement('div'); shadow.style.cssText = 'position:absolute;left:50%;top:418px;width:190px;height:20px;margin-left:-95px;border-radius:50%;background:radial-gradient(ellipse,rgba(40,228,252,.38),rgba(40,228,252,0) 70%)'; document.body.appendChild(shadow);
var wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;left:50%;top:210px;width:290px;height:290px;margin:-145px 0 0 -145px'; document.body.appendChild(wrap);
var cv = document.createElement('canvas'); cv.width = 168; cv.height = 168; cv.style.cssText = 'width:290px;height:290px;image-rendering:pixelated;border:2px solid #28e47c;box-shadow:0 0 28px rgba(40,228,124,.55)'; wrap.appendChild(cv);
var cap = document.createElement('div'); cap.style.cssText = 'position:absolute;left:0;width:480px;top:440px;text-align:center;color:#28e4fc;font-size:18px;letter-spacing:10px'; cap.textContent = 'EVELYN'; document.body.appendChild(cap);
var mood = document.createElement('div'); mood.style.cssText = 'position:absolute;left:0;width:480px;top:462px;text-align:center;color:#6a7aa8;font-size:11px;letter-spacing:3px'; document.body.appendChild(mood);
window.__t = function (t) {
  var m = t < 2 ? 'idle' : t < 4 ? 'thinking' : t < 7 ? 'talking' : t < 8.5 ? 'happy' : 'idle';
  window.EvelynArt.drawEvelynPortrait(cv, { mood: m, frame: Math.round(t * 60) });
  var sy = 16 * Math.sin(2 * Math.PI * t / 3.3), sx = 6 * Math.sin(2 * Math.PI * t / 5.0), tilt = 1.6 * Math.sin(2 * Math.PI * t / 4.1);
  wrap.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) rotate(' + tilt.toFixed(2) + 'deg)';
  var k = 1 - (sy + 16) / 90; shadow.style.transform = 'scale(' + k.toFixed(3) + ',' + k.toFixed(3) + ')'; shadow.style.opacity = (0.55 + 0.4 * k).toFixed(2);
  stars.forEach(function (s) { s[0].style.opacity = (0.25 + 0.75 * Math.abs(Math.sin(t * 1.7 + s[1]))).toFixed(2); s[0].style.top = (((s[1] * 53 % 470) + t * (3 + s[1] % 5)) % 480).toFixed(1) + 'px'; });
  mood.textContent = 'MOOD  ' + m.toUpperCase();
};
"""

def face(p):
    b = p.chromium.launch(executable_path=BRAVE, headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 480, "height": 480}).new_page()
    pg.goto("about:blank")
    pg.add_script_tag(path=os.path.join(NEON, "evelyn_art.js"))
    pg.evaluate(FACE_PAGE)
    frames = []
    for i in range(100):                      # 100 frames x 100 ms = exactly 10.0 s
        pg.evaluate("window.__t(%f)" % (i * 0.1))
        frames.append((Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("RGB"), 100))
    b.close()
    save_gif(frames, "evelyn_face_float.gif", 96)

def features(p):
    W, H, OUTW = 1000, 620, 800
    b = p.chromium.launch(executable_path=BRAVE, headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": W, "height": H}).new_page()
    frames = []
    def snap(ms=170):
        frames.append((Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("RGB"), ms))
    def hold(n, ms=170, gap=0.1):
        for _ in range(n):
            snap(ms); time.sleep(gap)
    def view(sel):
        pg.click(sel); time.sleep(0.35)
    pg.goto(base + "evelyn_concourse.html")
    pg.wait_for_function("document.body.innerText.indexOf('CHUM LOFT') >= 0", timeout=30000)
    time.sleep(0.8)

    # 1. A door, a cartridge, and a few answers
    pg.evaluate("(function(){var bs=Array.prototype.filter.call(document.querySelectorAll('button'),function(b){return /\\(\\d+\\)$/.test(b.textContent)});bs[0].click()})()")
    time.sleep(0.3); hold(2)
    pg.evaluate("(function(){var bs=Array.prototype.filter.call(document.querySelectorAll('button'),function(b){return /^#\\d+ /.test(b.textContent)});bs[0].click()})()")
    time.sleep(0.5); hold(3)
    for _ in range(4):
        n = pg.evaluate("document.querySelectorAll('#playBtns button').length")
        if n:
            pg.click("#playBtns button >> nth=0"); time.sleep(0.35); hold(2, 200)

    # 2. The rule validator: a good cartridge, then a broken one
    view("#viewWorkshop"); hold(2)
    pg.click("#wkValidate"); time.sleep(0.3); hold(3, 220)
    pg.evaluate("(function(){var t=document.getElementById('wkJson');var o=JSON.parse(t.value);o.goal='Walk across Coccyx Corale plaza at noon.';t.value=JSON.stringify(o,null,2)})()")
    pg.click("#wkValidate"); time.sleep(0.3); hold(4, 240)

    # 3. The parent read-out
    view("#viewParent"); hold(3, 200)

    # 4. The glass-box debugger with single-step
    view("#viewEcho"); pg.click("#btnXray"); time.sleep(0.4); hold(3)
    pg.click("#xrPause"); time.sleep(0.2); hold(1)
    for _ in range(3): pg.click("#xrStep"); time.sleep(0.25); snap(200)
    pg.click("#btnXray"); time.sleep(0.2)

    # 5. The safety charter: one refusal, one useful answer
    pg.click("#chatIn"); pg.keyboard.type("Should I mix bleach and ammonia to clean faster?", delay=12)
    pg.keyboard.press("Enter"); time.sleep(0.5); hold(4, 260)
    pg.fill("#chatIn", "How do I read OBD-II fault code P0300 on a 2002 truck?"); pg.keyboard.press("Enter"); time.sleep(0.5); hold(4, 260)

    # 6. Lab: MiniSQL and the module list
    view("#viewLab"); view("#labTab-code"); pg.click("#labSqlRun"); time.sleep(0.3); hold(4, 220)
    view("#labTab-status"); hold(5, 220)
    b.close()
    for i, (im, ms) in enumerate(frames):
        if im.width != OUTW: frames[i] = (im.resize((OUTW, int(im.height * OUTW / im.width)), Image.LANCZOS), ms)
    save_gif(frames, "evelyn_features.gif", 96)

with sync_playwright() as p:
    if mode in ("face", "both"): face(p)
    if mode in ("features", "both"): features(p)
srv.shutdown()
