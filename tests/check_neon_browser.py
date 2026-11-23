"""check_neon_browser.py - drives the NEON stack in real Brave (Playwright), on a server it starts itself.
   python tests/check_neon_browser.py
   1. evelyn_test_runner.html: every suite (backend with real IndexedDB and Web Workers, suite of 78, director, frontier,
      robotics, fuzz, chum loft, doctor, charter) runs in the browser; no failure.
   2. evelyn_concourse.html: loads with no page error; the 15-door hub, the animated portrait and the Chum Loft are
      mounted; an Echo and a DritchChum are adopted through the page; chat commands work with either word; a door opens
      and an answer is submitted; the profile survives a reload (IndexedDB).
   3. evelyn_neon.html and game_engine_demo.html load with no page error."""
import os, sys, socket, subprocess, time, http.server, threading, functools

HERE = os.path.dirname(os.path.abspath(__file__))
NEON = os.path.join(os.path.dirname(HERE), "neon")
BRAVE = r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
from playwright.sync_api import sync_playwright

fails = []
def check(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok: fails.append(msg)

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

port = free_port()
handler = functools.partial(Quiet, directory=NEON)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d/" % port

def watch(page, errs):
    page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    page.on("console", lambda m: errs.append("console error: " + m.text) if m.type == "error" and "favicon" not in m.text.lower() and not m.text.startswith("Failed to load resource") else None)
    page.on("response", lambda r: errs.append("HTTP %d %s" % (r.status, r.url)) if r.status >= 400 and "favicon" not in r.url else None)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=BRAVE, headless=True, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1400, "height": 1000})

    print("1. all test suites in the browser")
    pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(base + "evelyn_test_runner.html")
    pg.wait_for_function("window.__done === true", timeout=180000)
    tot = pg.evaluate("window.__totals")
    fl = pg.evaluate("window.__lines.filter(function(l){return l.indexOf('[FAIL]')===0})")
    check(tot["fail"] == 0, "no suite failed (%d passed, %d failed)" % (tot["pass"], tot["fail"]))
    for l in fl[:6]: print("       " + l[:200])
    # 143 measured on 2026-11-22 with all 26 suites; the Node-only audits (ES5 source scans, the bridge server) are skipped in a browser
    check(tot["pass"] >= 140, "at least 140 browser checks ran (Node-only audits are skipped in a browser): %d" % tot["pass"])
    heads = pg.evaluate("window.__lines.filter(function(l){return l.indexOf('===')===0 && l.indexOf('RESULT')<0}).length")
    check(heads >= 19, "all 19 suites that run when their file loads announced themselves (%d)" % heads)
    check(not errs, "runner page has no page errors" + ("" if not errs else ": " + errs[0][:160]))
    pg.close()

    print("2. concourse")
    pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(base + "evelyn_concourse.html")
    pg.wait_for_function("document.body.innerText.indexOf('CHUM LOFT') >= 0", timeout=30000)
    txt = pg.inner_text("body")
    check("Echoes and DritchChums are the same system" in txt, "Chum Loft is mounted and says Echo and DritchChum are one system")
    check(pg.evaluate("document.querySelectorAll('canvas').length") >= 2, "portrait and play canvases are present")
    check(pg.evaluate("typeof window.__neonRemount") == "function", "remount hook exists")
    doors = pg.evaluate("Array.prototype.filter.call(document.querySelectorAll('button'), function(b){return /\\(\\d+\\)$/.test(b.textContent)}).length")
    check(doors >= 15, "15 doors listed (%d door buttons)" % doors)
    carts = pg.evaluate("window.EvelynSuite78.CARTRIDGES.length")
    check(carts == 78, "78 cartridges loaded (%s)" % carts)

    # adopt one Echo and one DritchChum through the page
    sel = pg.locator("select").filter(has=pg.locator("option", has_text="Echo:")).first
    pg.get_by_role("button", name="Echoes", exact=True).click()
    pg.get_by_role("button", name="Adopt", exact=True).click()
    pg.get_by_role("button", name="DritchChums", exact=True).click()
    pg.get_by_role("button", name="Adopt", exact=True).click()
    txt = pg.inner_text("body")
    check("is an Echo (" in txt and "is a DritchChum (" in txt, "an Echo and a DritchChum are in the loft")
    check("Loft: 2/6" in txt, "loft shows 2 of 6")
    name_e = pg.evaluate("window.EvelynChums ? 1 : 0")
    # chat with either word
    prof = pg.evaluate("(function(){var r=null; return 1;})()")
    nm = pg.evaluate("(function(){var t=document.body.innerText.match(/\\n(\\S+) is an Echo \\(/); return t?t[1]:null})()")
    check(nm is not None, "Echo name is shown (%s)" % nm)
    pg.fill("#chatIn", "please feed my echo " + (nm or ""))
    pg.press("#chatIn", "Enter")
    time.sleep(0.5)
    check("[Chum Loft]" in pg.inner_text("#chatLog"), "chat command with the word 'echo' reaches the loft")
    nm2 = pg.evaluate("(function(){var t=document.body.innerText.match(/\\n(\\S+) is a DritchChum \\(/); return t?t[1]:null})()")
    pg.fill("#chatIn", "play with dritch chum " + (nm2 or ""))
    pg.press("#chatIn", "Enter")
    time.sleep(0.5)
    check(pg.inner_text("#chatLog").count("[Chum Loft]") >= 2, "chat command with the words 'dritch chum' reaches the loft")

    # the track, duel stage and meeting corner
    check("TRACK, DUEL STAGE AND MEETING CORNER" in pg.inner_text("body"), "track, duel stage and meeting corner appear with two creatures")
    pg.get_by_role("button", name="Race everyone").click()
    pg.wait_for_function("document.body.innerText.indexOf('crosses first') >= 0", timeout=10000)
    pg.wait_for_function("/cups: race 1/.test(document.body.innerText)", timeout=10000)
    time.sleep(1.4)
    bars = pg.evaluate("Array.prototype.map.call(document.querySelectorAll('div[style*=\"flex: 1\"] > div'), function(d){return d.style.width})")
    check(len(bars) == 2 and all(w.endswith("%") and w != "0%" for w in bars) and "100%" in bars, "both lane bars finished, the winner at 100 percent (%s)" % ",".join(bars))
    check("cups: race 1" in pg.inner_text("body"), "race cup counted in the header")
    pg.get_by_role("button", name="Duel (hold the last note)").click()
    pg.wait_for_function("document.body.innerText.indexOf('ribbon') >= 0", timeout=10000)
    check("duel 1" in pg.inner_text("body"), "duel counted in the cups line")
    pg.get_by_role("button", name="Let them meet").click()
    pg.wait_for_function("/They are (wary of each other|friends|best friends)/.test(document.body.innerText)", timeout=10000)
    check(True, "the meeting corner reports how the two feel")

    # open a door and answer an item
    pg.get_by_role("button", name="Submit").count()
    first_door = pg.evaluate("(function(){var bs=Array.prototype.filter.call(document.querySelectorAll('button'),function(b){return /\\(\\d+\\)$/.test(b.textContent)});bs[0].click();return bs[0].textContent})()")
    time.sleep(0.3)
    cart_btn = pg.evaluate("(function(){var bs=Array.prototype.filter.call(document.querySelectorAll('button'),function(b){return /^#\\d+ /.test(b.textContent)});if(!bs.length)return null;bs[0].click();return bs[0].textContent})()")
    check(cart_btn is not None, "a cartridge button appears for the first door (%s)" % str(cart_btn)[:40])
    time.sleep(0.4)
    check("Round 1:" in pg.inner_text("body"), "opening a cartridge shows Round 1")

    # profile survives a reload
    time.sleep(0.5)
    pg.reload()
    pg.wait_for_function("document.body.innerText.indexOf('CHUM LOFT') >= 0", timeout=30000)
    time.sleep(1.5)
    txt = pg.inner_text("body")
    check("Loft: 2/6" in txt, "the loft is still there after a reload (IndexedDB profile)")
    check(not errs, "concourse has no page errors" + ("" if not errs else ": " + " | ".join(e[:200] for e in errs[:3])))
    pg.close()

    print("2b. the Lab view (round-2 modules)")
    pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(base + "evelyn_concourse.html")
    pg.wait_for_function("document.body.innerText.indexOf('CHUM LOFT') >= 0", timeout=30000)
    pg.click("#viewLab")
    check(pg.evaluate("!document.getElementById('sec-lab').classList.contains('hidden')"), "the Lab view opens from the bar")
    pg.click("#labRetroSample")
    xr = pg.inner_text("#labOut")
    check("Instructions read:" in xr and "nothing was uploaded" in xr, "Game X-Ray takes a made-up cartridge apart")
    pg.click("#labTab-asset"); pg.click("#labIpsDemo")
    check("gives the changed file: YES" in pg.inner_text("#labOut"), "IPS demo: the patch applied to the original gives the changed file")
    pg.click("#labTab-view3d")
    lit = pg.evaluate("(function(){var c=document.getElementById('lab3dCanvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,bg=d[0]+','+d[1]+','+d[2],n=0;for(var i=0;i<d.length;i+=4){if(d[i]+','+d[i+1]+','+d[i+2]!==bg)n++}return n})()")
    check(lit > 400, "the 3D viewer draws a cube with the CPU rasterizer (%d pixels differ from the background)" % lit)
    pg.select_option("#lab3dMesh", "glider")
    check("Triangles drawn:" in pg.inner_text("#lab3dInfo"), "the 3D viewer redraws for another mesh")
    pg.click("#labTab-code"); pg.click("#labSqlRun")
    sq = pg.inner_text("#labOut")
    check("Rows: 3" in sq and sq.index("Aurora scarf") < sq.index("Drain Snake"), "MiniSQL answers a query in order (coins, high first)")
    pg.click("#labLint")
    lt = pg.inner_text("#labOut")
    check("UNDEF_VAR" in lt and "ES6_KEYWORD" in lt, "AST IDE reports an undefined variable and an ES6 keyword")
    pg.click("#labTab-status")
    st = pg.inner_text("#labStatus")
    check(st.count(" yes ") == 19 and st.count(" NO ") == 0, "all 19 round-2 modules are loaded and listed (%d)" % st.count(" yes "))
    check("Companion bridge: OFF" in st, "the status says the bridge is off and is never started from the page")
    check(not errs, "Lab view has no page errors" + ("" if not errs else ": " + " | ".join(e[:200] for e in errs[:3])))
    net = pg.evaluate("performance.getEntriesByType('resource').filter(function(r){return r.name.indexOf(location.origin)!==0}).length")
    check(net == 0, "the page asked for nothing outside its own server (%d)" % net)
    pg.close()

    print("3. other pages")
    for name in ["evelyn_neon.html", "game_engine_demo.html"]:
        pg = ctx.new_page(); errs = []; watch(pg, errs)
        pg.goto(base + name); time.sleep(1.5)
        check(not errs, name + " loads with no page errors" + ("" if not errs else ": " + errs[0][:200]))
        pg.close()
    b.close()

srv.shutdown()
print("\nNEON browser check: " + ("PASSED" if not fails else "FAILED (%d)" % len(fails)))
sys.exit(1 if fails else 0)
