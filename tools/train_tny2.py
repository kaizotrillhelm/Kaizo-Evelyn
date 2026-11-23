"""train_tny2.py - train a TINY.BIN that evelyn_core.js loads, from pairs of a prompt and a short target.

  python tools/train_tny2.py pairs.jsonl TINY.BIN [--D 64 --L 4 --H 4 --HID 128 --epochs 60 --lr 3e-3 --seed 1 --batch 16]

pairs.jsonl: one JSON object a line, {"prompt": "EXP:muddy river water sick", "target": "water purification"} or
{"prompt": "RT:implement an avl tree", "target": "HIGH"}. A sequence is prompt, the separator token 1, target, token 1; the loss is
taken on the target and the closing token only. Every fifth pair (lines 0, 5, 10, ...) is held out: it is written to
<out>.val.jsonl and never trained on, and the loss on it is printed.

The architecture and the file are the ones js/evelyn_core.js reads (checked by reading it): RMS norm with the epsilon inside the
root, query, key, value and output matrices without bias, a ReLU feed-forward, the output layer shares the token table, letters are
ord(c) - 30 (tokens 2 to 96), token 1 separates and ends. Weights are written as one int8 row each with its own float scale, as
the loader expects. The engine also stores keys and values as int8, which training does not do, so a trained model can differ a
little from its torch self: tools/eval_roles.js measures the model the engine really runs.

Needs torch and numpy. The model is small (D 64: about 280 KB) and trains on the CPU in minutes."""
import argparse
import json
import math
import os
import struct
import sys

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

VOCAB, CTX = 97, 128


def encode(s):
    return [ord(ch) - 30 for ch in s if 32 <= ord(ch) <= 126]


class RMSNorm(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.g = nn.Parameter(torch.ones(d))

    def forward(self, x):
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + 1e-5) * self.g


class Block(nn.Module):
    def __init__(self, d, h, hid):
        super().__init__()
        self.h, self.hd = h, d // h
        self.g1 = RMSNorm(d)
        self.wq = nn.Linear(d, d, bias=False)
        self.wk = nn.Linear(d, d, bias=False)
        self.wv = nn.Linear(d, d, bias=False)
        self.wo = nn.Linear(d, d, bias=False)
        self.g2 = RMSNorm(d)
        self.f1 = nn.Linear(d, hid, bias=False)
        self.f2 = nn.Linear(hid, d, bias=False)

    def forward(self, x, mask):
        B, T, D = x.shape
        h = self.g1(x)
        q = self.wq(h).view(B, T, self.h, self.hd).transpose(1, 2)
        k = self.wk(h).view(B, T, self.h, self.hd).transpose(1, 2)
        v = self.wv(h).view(B, T, self.h, self.hd).transpose(1, 2)
        att = (q @ k.transpose(-2, -1)) / math.sqrt(self.hd)
        att = att.masked_fill(mask[:T, :T] == 0, float("-inf"))
        att = F.softmax(att, dim=-1)
        out = (att @ v).transpose(1, 2).contiguous().view(B, T, D)
        x = x + self.wo(out)
        return x + self.f2(F.relu(self.f1(self.g2(x))))


class Tiny2Torch(nn.Module):
    def __init__(self, D=64, L=4, H=4, HID=128):
        super().__init__()
        self.D, self.L, self.H, self.HID = D, L, H, HID
        self.emb = nn.Embedding(VOCAB, D)
        self.pos = nn.Embedding(CTX, D)
        self.blocks = nn.ModuleList([Block(D, H, HID) for _ in range(L)])
        self.gf = RMSNorm(D)
        self.register_buffer("mask", torch.tril(torch.ones(CTX, CTX)))
        nn.init.normal_(self.emb.weight, std=0.5)
        nn.init.normal_(self.pos.weight, std=0.1)

    def forward(self, idx):
        B, T = idx.shape
        x = self.emb(idx) + self.pos(torch.arange(T, device=idx.device))
        for blk in self.blocks:
            x = blk(x, self.mask)
        return F.linear(self.gf(x), self.emb.weight)   # the output layer is the token table


def write_table(f, weight):
    w = weight.detach().cpu().float().numpy()
    for r in range(w.shape[0]):
        row = w[r]
        big = float(np.max(np.abs(row)))
        scale = big / 127.0 if big > 1e-20 else 1e-20
        q = np.clip(np.rint(row / scale), -127, 127).astype(np.int8)
        f.write(struct.pack("<f", scale))
        f.write(q.tobytes())


def write_gains(f, g):
    f.write(g.detach().cpu().float().numpy().astype("<f4").tobytes())


def export_tny2(model, path):
    with open(path, "wb") as f:
        f.write(b"TNY2")
        f.write(struct.pack("<HHHH", model.D, model.L, model.H, model.HID))
        write_table(f, model.emb.weight)
        write_table(f, model.pos.weight)
        for blk in model.blocks:
            write_gains(f, blk.g1.g)
            write_table(f, blk.wq.weight)
            write_table(f, blk.wk.weight)
            write_table(f, blk.wv.weight)
            write_table(f, blk.wo.weight)
            write_gains(f, blk.g2.g)
            write_table(f, blk.f1.weight)
            write_table(f, blk.f2.weight)
        write_gains(f, model.gf.g)


def make_sample(row):
    p = encode(row["prompt"])[:CTX - 32]
    t = encode(row["target"])[:30]
    return p + [1] + t + [1], len(p) + 1       # the first target token is predicted from position len(p)


def batches(samples, size, device):
    for i in range(0, len(samples), size):
        chunk = samples[i:i + size]
        n = max(len(s) for s, _ in chunk) - 1
        x = torch.zeros(len(chunk), n, dtype=torch.long)
        y = torch.full((len(chunk), n), -100, dtype=torch.long)
        for b, (seq, start) in enumerate(chunk):
            x[b, :len(seq) - 1] = torch.tensor(seq[:-1])
            y[b, :len(seq) - 1] = torch.tensor(seq[1:])
            y[b, :start - 1] = -100                   # no loss on the prompt
        yield x.to(device), y.to(device)


def loss_on(model, samples, device, size=64):
    model.eval()
    tot, cnt = 0.0, 0
    with torch.no_grad():
        for x, y in batches(samples, size, device):
            lg = model(x)
            l = F.cross_entropy(lg.view(-1, VOCAB), y.view(-1), ignore_index=-100, reduction="sum")
            tot += float(l.item()); cnt += int((y != -100).sum().item())
    model.train()
    return tot / max(1, cnt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pairs"); ap.add_argument("out")
    ap.add_argument("--D", type=int, default=64); ap.add_argument("--L", type=int, default=4)
    ap.add_argument("--H", type=int, default=4); ap.add_argument("--HID", type=int, default=128)
    ap.add_argument("--epochs", type=int, default=60); ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--batch", type=int, default=16)
    a = ap.parse_args()
    torch.manual_seed(a.seed); np.random.seed(a.seed)
    device = "cpu"       # a 280 KB model: the graphics cards are left to the models that need them

    rows = []
    with open(a.pairs, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    val_rows = [r for i, r in enumerate(rows) if i % 5 == 0]
    train_rows = [r for i, r in enumerate(rows) if i % 5 != 0]
    with open(a.out + ".val.jsonl", "w", encoding="utf-8") as f:
        for r in val_rows:
            f.write(json.dumps(r) + "\n")
    train = [make_sample(r) for r in train_rows]
    val = [make_sample(r) for r in val_rows]
    print("pairs: %d train, %d held out" % (len(train), len(val)))

    model = Tiny2Torch(a.D, a.L, a.H, a.HID).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
    rng = np.random.default_rng(a.seed)
    for ep in range(a.epochs):
        order = rng.permutation(len(train))
        shuffled = [train[i] for i in order]
        tot, cnt = 0.0, 0
        for x, y in batches(shuffled, a.batch, device):
            lg = model(x)
            loss = F.cross_entropy(lg.view(-1, VOCAB), y.view(-1), ignore_index=-100)
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += float(loss.item()); cnt += 1
        if (ep + 1) % 10 == 0 or ep == 0:
            print("epoch %3d/%d  train loss %.4f  held-out loss %.4f" % (ep + 1, a.epochs, tot / max(1, cnt), loss_on(model, val, device)))
    export_tny2(model, a.out)
    print("wrote %s (%d bytes); held-out pairs in %s.val.jsonl" % (a.out, os.path.getsize(a.out), a.out))


if __name__ == "__main__":
    main()
