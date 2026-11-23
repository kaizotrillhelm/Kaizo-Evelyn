"""fetch_reading_refs.py - fetches public-domain and freely readable texts for Evelyn's shelves into a folder OUTSIDE the repository.
   python tools/fetch_reading_refs.py G:/CandorPix/EvelynLibrary
   Writes <lib>/_raw/reading/<name>.txt, each starting with 3 header lines (Title, Source, Licence), and REPORT.json.
   - Project Gutenberg books come from the gutenberg.pglaf.org mirror and are accepted only when the book's own Title/Author header matches.
   - Web pages are read as text through the page's own HTML; a page that answers 403, 429 or a login wall is skipped, never worked around.
   Nothing is uploaded and nothing is fetched without a name in the lists below."""
import os, re, sys, json, time, urllib.request, urllib.error
from html.parser import HTMLParser

LIB = sys.argv[1] if len(sys.argv) > 1 else "./library"
OUT = os.path.join(LIB, "_raw", "reading")
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"}
report = {"saved": [], "skipped": []}

def get(url, tries=2):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 401): raise
            if i == tries - 1: raise
        except Exception:
            if i == tries - 1: raise
        time.sleep(1.5)

def gut_url(i, suffix):
    d = "/".join(list(str(i)[:-1])) or "0"
    return "https://gutenberg.pglaf.org/%s/%d/%d%s.txt" % (d, i, i, suffix)

def gutenberg(i, want_title, want_author, name, licence="Public domain (Project Gutenberg)"):
    for suf in ("-0", "", "-8"):
        try:
            data, _ = get(gut_url(i, suf))
        except Exception:
            continue
        txt = data.decode("utf-8", "replace")
        head = txt[:3000]
        t = re.search(r"Title:\s*(.+)", head); a = re.search(r"Author:\s*(.+)", head)
        title = (t.group(1).strip() if t else ""); author = (a.group(1).strip() if a else "")
        if want_title.lower() not in head.lower() or (want_author and want_author.lower() not in head.lower()):
            report["skipped"].append({"name": name, "id": i, "why": "title/author header did not match (%s / %s)" % (title, author)})
            return False
        s = re.search(r"\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n", txt); e = re.search(r"\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG", txt)
        body = txt[s.end():e.start()] if s and e else txt
        save(name, title or want_title, "https://www.gutenberg.org/ebooks/%d" % i, licence, body)
        return True
    report["skipped"].append({"name": name, "id": i, "why": "not found on the mirror"})
    return False

class T(HTMLParser):
    def __init__(self): HTMLParser.__init__(self); self.out = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "header", "footer", "noscript", "svg", "form"): self.skip += 1
        if tag in ("p", "br", "li", "h1", "h2", "h3", "h4", "div", "tr"): self.out.append("\n\n" if tag in ("p", "h1", "h2", "h3", "h4") else "\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "header", "footer", "noscript", "svg", "form") and self.skip: self.skip -= 1
        if tag in ("p", "h1", "h2", "h3", "h4"): self.out.append("\n\n")
    def handle_data(self, d):
        if not self.skip: self.out.append(d)

def webpage(url, name, title, licence, start=None, end=None):
    try:
        data, ctype = get(url)
    except urllib.error.HTTPError as e:
        report["skipped"].append({"name": name, "url": url, "why": "HTTP %d (not worked around)" % e.code}); return False
    except Exception as e:
        report["skipped"].append({"name": name, "url": url, "why": str(e)[:80]}); return False
    html = data.decode("utf-8", "replace")
    if start and start in html: html = html[html.index(start):]
    if end and end in html: html = html[:html.index(end)]
    p = T(); p.feed(html)
    txt = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", "".join(p.out))).strip()
    if len(txt) < 1500:
        report["skipped"].append({"name": name, "url": url, "why": "page text too short (%d chars)" % len(txt)}); return False
    save(name, title, url, licence, txt); return True

def save(name, title, source, licence, body):
    body = body.replace("\r", "")
    with open(os.path.join(OUT, name + ".txt"), "w", encoding="utf-8") as f:
        f.write("Title: %s\nSource: %s\nLicence: %s\n\n%s\n" % (title, source, licence, body))
    report["saved"].append({"name": name, "title": title, "source": source, "licence": licence, "chars": len(body)})
    print("saved", name, len(body))

# --- 1. kids' reading ---
gutenberg(21, "Aesop", "", "aesop-fables")
gutenberg(11, "Wonderland", "Carroll", "alice-in-wonderland")
gutenberg(34339, "The Princess and the Goblin", "MacDonald", "princess-and-the-goblin")
for i in (14838, 14814, 14407, 14304, 14566, 15575, 14868, 15136, 14796, 14837, 14233, 14872, 14873, 14869, 14870):
    if gutenberg(i, "", "Beatrix Potter", "potter-%d" % i): pass
    time.sleep(0.4)
# --- 3. civics ---
gutenberg(1, "Declaration of Independence", "", "declaration-of-independence")
gutenberg(5, "Constitution", "", "us-constitution")
gutenberg(1404, "Federalist", "", "federalist-papers")
webpage("https://www.archives.gov/founding-docs/declaration-transcript", "declaration-transcript-archives", "Declaration of Independence: a transcription (National Archives)", "US government work, public domain", start="When in the Course", end="Related Content")
# --- 4. conservative and classical-liberal ---
gutenberg(44800, "The Law", "Bastiat", "bastiat-the-law")
webpage("https://www.econlib.org/library/Essays/rdPncl1.html", "i-pencil-econlib", "I, Pencil (Leonard E. Read), as hosted by Econlib", "Essay freely published by FEE and Econlib; see the source page for terms")
webpage("https://fee.org/ebooks/economics-in-one-lesson/", "economics-in-one-lesson-fee", "Economics in One Lesson (Henry Hazlitt), as hosted by FEE", "Free ebook published by FEE; see the source page for terms")
# --- 5. liberal and progressive ---
gutenberg(34901, "On Liberty", "Mill", "mill-on-liberty")
gutenberg(71, "Civil Government", "Thoreau", "thoreau-civil-disobedience")
gutenberg(23, "Frederick Douglass", "", "douglass-narrative")
gutenberg(140, "The Jungle", "Sinclair", "sinclair-the-jungle")
# --- 2. health: Hesperian's own online edition, one book page that answered 200 ---
webpage("https://en.hesperian.org/hhg/Where_There_Is_No_Dentist", "hesperian-dentist-contents", "Where There Is No Dentist: contents page (Hesperian Health Guides)", "Free for non-commercial use; do not redistribute (Hesperian)")

with open(os.path.join(LIB, "_raw", "reading", "REPORT.json"), "w") as f: json.dump(report, f, indent=1)
print("saved", len(report["saved"]), "skipped", len(report["skipped"]))
for s in report["skipped"]: print("  skipped:", json.dumps(s)[:200])
