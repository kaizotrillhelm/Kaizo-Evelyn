#!/bin/sh
# Fetches open-licence coding references for Evelyn's shelves into a folder OUTSIDE the repository.
# Usage: sh tools/fetch_coding_refs.sh /g/CandorPix/EvelynLibrary
# Each source is a shallow git clone (public repositories only, no login, nothing uploaded).
# Licences and links are listed in CREDITS.md; the files themselves are never committed (.gitignore: library/).
OUT="${1:-./library}"
RAW="$OUT/_raw"
mkdir -p "$RAW"
clone() {  # name url [sparse path...]
  name="$1"; url="$2"; shift 2
  if [ -d "$RAW/$name/.git" ]; then echo "have $name"; return; fi
  echo "== $name"
  if [ "$#" -gt 0 ]; then
    git clone --quiet --depth 1 --filter=blob:none --sparse "$url" "$RAW/$name" && git -C "$RAW/$name" sparse-checkout set "$@"
  else
    git clone --quiet --depth 1 "$url" "$RAW/$name"
  fi
}
clone learnxinyminutes https://github.com/adambard/learnxinyminutes-docs.git
clone mdn-javascript https://github.com/mdn/content.git files/en-us/web/javascript
clone eloquent-javascript https://github.com/marijnh/Eloquent-JavaScript.git
clone think-python-2e https://github.com/AllenDowney/ThinkPython2.git
clone sicp https://github.com/sarabander/sicp.git
clone rust-book https://github.com/rust-lang/book.git src
clone node-api https://github.com/nodejs/node.git doc/api
clone javascript-info https://github.com/javascript-tutorial/en.javascript.info.git 1-js
if [ ! -f "$RAW/python-docs-text.zip" ]; then
  echo "== python docs"
  curl -sL -m 300 -o "$RAW/python-docs-text.zip" https://docs.python.org/3.13/archives/python-3.13-docs-text.zip
fi
echo done
