"""check_gui_llm_browser.py - the page, opened as a file (what a double click does), in a real Brave window.

  python tests/check_gui_llm_browser.py

Starts tests/mock_llm_server.js (a stand-in for llama-server / LM Studio with CORS on), opens js/index.html with a file:// address (no web
server for the page), and checks: the page loads with no script error; the four tabs work; the old tutor still answers; the "Model agent"
tab reaches the server from a file page (test, agent, arithmetic with no model call, code loop, sandbox run); a loop that never ends in the
sandbox is stopped after 3 seconds and the page stays usable. Nothing leaves the machine. Needs Python 3 and Playwright."""
import json
import os
import subprocess
import sys
import time
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRAVE = r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
passed, failed = 0, []


def check(name, cond, detail=''):
    global passed
    if cond:
        passed += 1
        print('[PASS] ' + name)
    else:
        failed.append(name + (': ' + str(detail) if detail else ''))
        print('[FAIL] ' + name + (': ' + str(detail)[:300] if detail else ''))


def main():
    srv = subprocess.Popen(['node', str(ROOT / 'tests' / 'mock_llm_server.js'), '0'], stdout=subprocess.PIPE, text=True)
    port = json.loads(srv.stdout.readline())['port']
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=BRAVE, headless=True)
            pg = b.new_page()
            pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
            pg.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
            pg.goto((ROOT / 'js' / 'index.html').as_uri())
            check('the page opens from a file address', pg.title() == 'Evelyn and her Echoes', pg.title())
            check('no script error on load', not errors, errors)
            check('the model scripts loaded', pg.evaluate('typeof EvelynLLM === "object" && typeof EvelynSkills === "object" && typeof EvelynStream === "object"'))

            # the old tutor still works
            pg.fill('#askInput', '18*4')
            pg.click('#askBtn')
            check('tab 1: the tutor answers 18*4', '72' in pg.inner_text('#askOut'), pg.inner_text('#askOut'))

            # the four tabs
            for tab, view in (('#tabAdv', '#viewAdv'), ('#tabCode', '#viewCode'), ('#tabLlm', '#viewLlm'), ('#tabAsk', '#viewAsk')):
                pg.click(tab)
                check('tab %s shows its panel' % tab, pg.is_visible(view))

            # tab 4 against the mock server
            pg.click('#tabLlm')
            pg.select_option('#llmPreset', 'custom')
            pg.fill('#llmUrl', 'http://127.0.0.1:%d' % port)
            pg.fill('#llmModel', 'mock-model')
            pg.click('#llmTest')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("Reachable") === 0 || document.getElementById("llmOut").textContent.indexOf("Not reachable") === 0', timeout=15000)
            out = pg.inner_text('#llmOut')
            check('Test connection reaches the server from a file page (CORS)', out.startswith('Reachable') and 'mock-model' in out, out)

            pg.fill('#llmQ', '17+25')
            pg.click('#llmAsk')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("42") >= 0', timeout=15000)
            check('the agent answers a sum with no model call', 'Fast-Path' in pg.inner_text('#llmOut'), pg.inner_text('#llmOut'))

            pg.fill('#llmQ', 'How many bells does the harbour tower of Brindlewick have?')
            pg.click('#llmAsk')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("17 bells") >= 0', timeout=15000)
            check('the agent asks the model and shows its answer', '17 bells' in pg.inner_text('#llmOut'), pg.inner_text('#llmOut'))

            pg.fill('#llmTask', 'function sumEven(a) returns the sum of the even numbers')
            pg.click('#llmWrite')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("function sumEven") >= 0', timeout=30000)
            out = pg.inner_text('#llmOut')
            check('Write code returns the code and the check passes', 'parses and defines' in out, out)

            pg.fill('#llmExpr', 'sumEven([1,2,3,4])')
            pg.click('#llmRun')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("Sandbox output") === 0', timeout=15000)
            out = pg.inner_text('#llmOut')
            check('the sandbox runs the code and shows the result', '=> 6' in out, out)

            pg.fill('#llmTask', 'function broken() returns 1')
            pg.click('#llmWrite')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("function broken") >= 0', timeout=30000)
            out = pg.inner_text('#llmOut')
            check('a code reply that fails the check is sent back and repaired', 'parses and defines' in out and '2 call' in out, out)

            # a loop that never ends: the sandbox must stop it and the page must stay usable
            pg.evaluate('window.__evelynRunSandbox("while (true) {}", "", function (o, note) { window.__loopNote = note || "finished"; })')
            t0 = time.time()
            pg.wait_for_function('window.__loopNote !== undefined', timeout=15000)
            check('a loop that never ends is stopped after about 3 seconds', 2.5 < time.time() - t0 < 8 and window_note(pg).startswith('stopped'), window_note(pg))
            pg.click('#tabAsk')
            check('the page is still usable after the loop', pg.is_visible('#viewAsk'))

            # an unreachable server gives a plain message, not a hang
            pg.click('#tabLlm')
            pg.fill('#llmUrl', 'http://127.0.0.1:9')
            pg.click('#llmTest')
            pg.wait_for_function('document.getElementById("llmOut").textContent.indexOf("Not reachable") === 0', timeout=15000)
            check('an unreachable server is reported in words', 'Enable CORS' in pg.inner_text('#llmOut'))
            # no b.close(): the frame of the loop that never ends can keep a renderer busy, and closing then waits for it; the process exit below
            # closes the pipe to the browser, which ends it
    finally:
        srv.terminate()
    real = [e for e in errors if 'ERR_CONNECTION_REFUSED' not in e and 'Failed to load resource' not in e]
    check('no script error during the whole run', not real, real)
    print('\n%d passed, %d failed' % (passed, len(failed)))
    for f in failed:
        print('  FAILED ' + f)
    sys.stdout.flush()
    os._exit(1 if failed else 0)


def window_note(pg):
    return pg.evaluate('window.__loopNote')


if __name__ == '__main__':
    main()
