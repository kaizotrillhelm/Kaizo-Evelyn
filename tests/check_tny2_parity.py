"""check_tny2_parity.py - does a file written by tools/train_tny2.py mean to js/evelyn_core.js what it means to torch?

  python tests/check_tny2_parity.py

Builds a small random model in torch (seeded), writes it with the trainer's exporter, runs the same letters through torch and through
the engine (tests/tny2_parity_node.js), and compares the next-letter scores at every position. The engine keeps keys and values as
int8 and the weights as int8 rows, torch keeps floats until export, so the scores are not equal; the check is that the best letter
agrees at nearly every position and the scores are strongly correlated. A wrong layer order, a wrong row layout or a wrong norm
would break both at once. Skips with a message when torch is not installed. Exit code 0 on pass or skip."""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
try:
    import torch
    import train_tny2 as T
except Exception as e:  # torch missing
    print("SKIPPED: torch is not available (%s)" % e)
    sys.exit(0)

os.makedirs(os.path.join(ROOT, "tests", "tmp"), exist_ok=True)
path = os.path.join(ROOT, "tests", "tmp", "parity.bin")
out = os.path.join(ROOT, "tests", "tmp", "parity.json")
torch.manual_seed(5)
model = T.Tiny2Torch(32, 3, 4, 64)
# the training sets the weights far from the random start; make the random model's scores spread out so that 'the best letter' means something
with torch.no_grad():
    for p in model.parameters():
        if p.dim() == 2:
            p.mul_(2.5)
T.export_tny2(model, path)

text = "EXP:my stomach hurts from muddy river water"
toks = T.encode(text) + [1]
x = torch.tensor([toks], dtype=torch.long)
with torch.no_grad():
    logits = model.eval()(x)[0].numpy()
json.dump({"tokens": toks, "logits": logits.tolist()}, open(out, "w"))

r = subprocess.run(["node", os.path.join(HERE, "tny2_parity_node.js"), path, out], capture_output=True, text=True)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
sys.exit(r.returncode)
