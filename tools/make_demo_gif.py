"""make_demo_gif.py - records a short tour of the NEON concourse in real Brave and writes an animated GIF.
   python tools/make_demo_gif.py [out.gif]
   Needs: playwright (Python) and Pillow. It starts its own loopback server on neon/ and opens nothing else."""
import os, sys, io, time, socket, threading, functools, http.server
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NEON = os.path.join(os.path.dirname(HERE), "neon")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), "media", "evelyn_demo.gif")
BRAVE = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
W, H, OUTW = 1000, 620, 800

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=NEON))
threading.Thread(target=srv.serve_forever, daemon=True).start()

frames = []   # (image, ms)
def snap(pg, ms=140):
    im = Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("RGB")
    if im.width != OUTW: im = im.resize((OUTW, int(im.height * OUTW / im.width)), Image.LANCZOS)
    frames.append((im, ms))
def hold(pg, n, ms=140, gap=0.12):
    for _ in range(n):
        snap(pg, ms); time.sleep(gap)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=BRAVE, headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": W, "height": H}).new_page()
    pg.goto("http://127.0.0.1:%d/evelyn_concourse.html" % port)
    pg.wait_for_function("document.body.innerText.indexOf('CHUM LOFT') >= 0", timeout=30000)
    time.sleep(1.0)
    hold(pg, 8)                                   # the hub and the animated portrait
    pg.click("#chatIn")
    for ch in "What is a Static Choir Hound?":
        pg.keyboard.type(ch);
        if ch in "aeiou ": snap(pg, 90)
    pg.keyboard.press("Enter"); time.sleep(0.5)
    hold(pg, 7)                                   # the answer
    pg.click("#viewLab"); time.sleep(0.3)
    pg.click("#labRetroSample"); time.sleep(0.3)
    hold(pg, 6, 180)                              # Game X-Ray on a made-up cartridge
    pg.click("#labTab-asset"); pg.click("#labIpsDemo"); time.sleep(0.3)
    hold(pg, 5, 180)                              # IPS patch demo
    pg.click("#labTab-view3d"); time.sleep(0.3)
    for v in range(0, 314, 14):                   # the cube turns, drawn by the CPU
        pg.evaluate("(function(v){var e=document.getElementById('lab3dRy');e.value=v;e.dispatchEvent(new Event('input'))})(%d)" % v)
        snap(pg, 80); time.sleep(0.05)
    pg.select_option("#lab3dMesh", "glider")
    for v in range(0, 314, 20):
        pg.evaluate("(function(v){var e=document.getElementById('lab3dRy');e.value=v;e.dispatchEvent(new Event('input'))})(%d)" % v)
        snap(pg, 80); time.sleep(0.05)
    pg.click("#labTab-code"); pg.click("#labLint"); time.sleep(0.3)
    hold(pg, 6, 200)                              # the code checker
    pg.click("#viewEcho"); time.sleep(0.4)
    hold(pg, 4)
    b.close()
srv.shutdown()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
imgs = [f[0].quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
imgs[0].save(OUT, save_all=True, append_images=imgs[1:], duration=[f[1] for f in frames], loop=0, optimize=True, disposal=1)
print("frames", len(frames), "bytes", os.path.getsize(OUT), "->", OUT)
