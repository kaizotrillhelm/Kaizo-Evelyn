/* evelyn_proto.c - line protocol used by tests/run_conformance.js.
   evelyn_proto script.txt     (same script, same output as js/evelyn_proto.js) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ctype.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif
#include "evelyn.h"

static EvlLib lib;
static EvlProfile pm;
static EvlModel model;
static EvlMulti multi;
static EvlRun lastrun;

static EvlStr out;

static void say(const char *s) { evl_str_add(&out, s); evl_str_addc(&out, '\n'); }
static void say2(const char *a, const char *b) { evl_str_add(&out, a); evl_str_add(&out, b); evl_str_addc(&out, '\n'); }

/* ---------- escapes ---------- */
static void unesc(const char *s, EvlStr *o)
{
  size_t i = 0, n = strlen(s);
  evl_str_clear(o);
  while (i < n) {
    if (s[i] == '\\' && i + 1 < n) {
      char d = s[i + 1];
      if (d == 'n') { evl_str_addc(o, '\n'); i += 2; continue; }
      if (d == 't') { evl_str_addc(o, '\t'); i += 2; continue; }
      if (d == '\\') { evl_str_addc(o, '\\'); i += 2; continue; }
      if (d == 'x' && i + 3 < n + 0 && isxdigit((unsigned char)s[i + 2]) && isxdigit((unsigned char)s[i + 3])) {
        char h[3];
        h[0] = s[i + 2]; h[1] = s[i + 3]; h[2] = '\0';
        evl_str_addc(o, (int)strtol(h, NULL, 16));
        i += 4;
        continue;
      }
    }
    evl_str_addc(o, s[i]);
    i++;
  }
}

static void esc(const char *s, EvlStr *o)
{
  static const char hexd[] = "0123456789abcdef";
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == 92) evl_str_add(o, "\\\\");
    else if (c == 10) evl_str_add(o, "\\n");
    else if (c == 9) evl_str_add(o, "\\t");
    else if (c >= 32 && c <= 126) evl_str_addc(o, c);
    else { evl_str_add(o, "\\x"); evl_str_addc(o, hexd[c >> 4]); evl_str_addc(o, hexd[c & 15]); }
  }
}

static void say_esc(const char *prefix, const char *s)
{
  EvlStr t;
  evl_str_init(&t);
  evl_str_add(&t, prefix);
  esc(s, &t);
  say(t.s);
  evl_str_free(&t);
}

/* say each line of text with a prefix */
static void say_lines(const char *prefix, const char *text)
{
  const char *p = text;
  for (;;) {
    const char *eol = strchr(p, '\n');
    EvlStr t;
    char *line = (char *)malloc((eol ? (size_t)(eol - p) : strlen(p)) + 1);
    size_t n = eol ? (size_t)(eol - p) : strlen(p);
    memcpy(line, p, n); line[n] = '\0';
    evl_str_init(&t);
    evl_str_add(&t, prefix); evl_str_addc(&t, ' ');
    esc(line, &t);
    say(t.s);
    evl_str_free(&t); free(line);
    if (!eol) break;
    p = eol + 1;
  }
}

static void hex_of(const unsigned char *b, size_t n, EvlStr *o)
{
  static const char hexd[] = "0123456789abcdef";
  size_t i;
  for (i = 0; i < n; i++) { evl_str_addc(o, hexd[b[i] >> 4]); evl_str_addc(o, hexd[b[i] & 15]); }
}

static size_t unhex(const char *h, unsigned char *b)
{
  size_t i, n = 0;
  for (i = 0; h[i] && h[i + 1]; i += 2) {
    char t[3];
    t[0] = h[i]; t[1] = h[i + 1]; t[2] = '\0';
    b[n++] = (unsigned char)strtol(t, NULL, 16);
  }
  return n;
}

static evl_u32 fnv1a(const unsigned char *b, size_t n)
{
  evl_u32 h = (evl_u32)0x811c9dc5UL;
  size_t i;
  for (i = 0; i < n; i++) { h ^= b[i]; h = (evl_u32)((h * (evl_u32)0x01000193UL) & 0xFFFFFFFFUL); }
  return h;
}

static void num(double x, EvlStr *o) { char t[48]; evl_fmt_num(x, t); evl_str_add(o, t); }

/* split a on '|' (every bar becomes a NUL); parts[0..max-1] point at the first fields, extra fields are dropped */
static int split_bar(char *a, char **parts, int max)
{
  int n = 0;
  char *p = a;
  if (max > 0) parts[n++] = p;
  for (; *p; p++) {
    if (*p == '|') { *p = '\0'; if (n < max) parts[n++] = p + 1; }
  }
  return n;
}

static void numlist(const char *s, double *v, int *n, int cap)
{
  const char *p = s;
  *n = 0;
  if (!*s) return;
  for (;;) {
    if (*n < cap) v[(*n)++] = evl_val_of(p);
    p = strchr(p, ',');
    if (!p) break;
    p++;
  }
}

static int cmp_var(const void *a, const void *b) { return strcmp((*(const EvlVar *const *)a)->name, (*(const EvlVar *const *)b)->name); }

static void unq(const char *s, EvlStr *o) { evl_str_clear(o); evl_str_add(o, s); }

/* ---------- commands ---------- */
static void do_cmd(const char *cmd, const char *arg)
{
  EvlStr t, u;
  char *a;
  evl_str_init(&t); evl_str_init(&u);

  if (strcmp(cmd, "LZ.ENC") == 0) {
    EvlStr txt, b64, dec;
    unsigned char *z, *z2;
    size_t zn, z2n;
    evl_str_init(&txt); evl_str_init(&b64); evl_str_init(&dec);
    unesc(arg, &txt);
    zn = evl_lz_compress(txt.s, &z);
    evl_str_add(&t, "HEX"); if (zn) { evl_str_addc(&t, ' '); hex_of(z, zn, &t); } say(t.s);
    evl_b64_encode(z, zn, &b64);
    evl_str_clear(&t); evl_str_add(&t, "B64"); if (b64.n) { evl_str_addc(&t, ' '); evl_str_add(&t, b64.s); } say(t.s);
    z2n = evl_b64_decode(b64.s, &z2);
    evl_lz_decompress(z2, z2n, &dec);
    say_esc("DEC ", dec.s);
    free(z); free(z2); evl_str_free(&txt); evl_str_free(&b64); evl_str_free(&dec);
  } else if (strcmp(cmd, "LZ.DEC") == 0) {
    unsigned char *b = (unsigned char *)malloc(strlen(arg) / 2 + 2);
    size_t n = unhex(arg, b);
    if (evl_lz_decompress(b, n, &u) == 0) say_esc("DEC ", u.s); else say("ERR");
    free(b);
  } else if (strcmp(cmd, "B64.ENC") == 0) {
    unsigned char *b = (unsigned char *)malloc(strlen(arg) / 2 + 2);
    size_t n = unhex(arg, b);
    evl_b64_encode(b, n, &u);
    say2("B64 ", u.s);
    free(b);
  } else if (strcmp(cmd, "B64.DEC") == 0) {
    unsigned char *b;
    size_t n = evl_b64_decode(arg, &b);
    evl_str_add(&t, "HEX"); if (n) { evl_str_addc(&t, ' '); hex_of(b, n, &t); } say(t.s);
    free(b);
  } else if (strcmp(cmd, "FMT") == 0 || strcmp(cmd, "VAL") == 0) {
    evl_str_add(&t, cmd); evl_str_addc(&t, ' '); num(evl_val_of(arg), &t); say(t.s);
  } else if (strcmp(cmd, "CLEAN") == 0) {
    unesc(arg, &u); evl_str_clear(&t); evl_clean_ascii(u.s, &t);
    say_esc("TEXT ", t.s);
  } else if (strcmp(cmd, "WORDS") == 0) {
    EvlList w; int i;
    unesc(arg, &u);
    evl_list_init(&w); evl_tokenize_words(u.s, &w);
    evl_str_add(&t, "WORDS ");
    for (i = 0; i < w.n; i++) { if (i) evl_str_addc(&t, ' '); evl_str_add(&t, w.v[i]); }
    say(t.s);
    evl_list_free(&w);
  }

  else if (strcmp(cmd, "LIB.CLEAR") == 0) { evl_lib_clear(&lib); say("OK"); }
  else if (strcmp(cmd, "LIB.STARTER") == 0) {
    long e, c;
    evl_lib_starter(&lib); evl_lib_stats(&lib, &e, &c);
    evl_str_add(&t, "ENTRIES "); evl_str_addi(&t, e); say(t.s);
  } else if (strcmp(cmd, "LIB.ADD") == 0) {
    char *f[5]; int n, id; char empty[1];
    empty[0] = '\0';
    unesc(arg, &u); a = evl_strdup(u.s);
    f[1] = f[2] = f[3] = empty;
    n = split_bar(a, f, 4);
    (void)n;
    id = evl_lib_add(&lib, f[0], f[1], f[2], f[3]);
    evl_str_add(&t, "ID "); evl_str_addi(&t, id); say(t.s);
    free(a);
  } else if (strcmp(cmd, "LIB.INGEST") == 0) {
    char *bar;
    int n;
    unesc(arg, &u); a = evl_strdup(u.s);
    bar = strchr(a, '|');
    if (!bar) bar = a + strlen(a) - 1;
    *bar = '\0';
    n = evl_lib_ingest(&lib, bar + 1, a);
    evl_str_add(&t, "CHUNKS "); evl_str_addi(&t, n); say(t.s);
    free(a);
  } else if (strcmp(cmd, "LIB.SEARCH") == 0) {
    char *bar;
    int k, ids[64], nh, i;
    unesc(arg, &u); a = evl_strdup(u.s);
    bar = strchr(a, '|');
    if (!bar) { say("NONE"); free(a); goto out; }
    *bar = '\0';
    k = atoi(a);
    if (k > 64) k = 64;
    nh = evl_lib_search(&lib, bar + 1, k, ids);
    if (nh == 0) say("NONE");
    for (i = 0; i < nh; i++) {
      EvlStr f, e;
      evl_str_init(&f); evl_str_init(&e);
      evl_lib_read(&lib, ids[i], &f, &e);
      evl_str_clear(&t);
      evl_str_add(&t, "HIT "); evl_str_addi(&t, ids[i]); evl_str_addc(&t, '|');
      esc(lib.rec[ids[i]].topic, &t); evl_str_addc(&t, '|');
      esc(lib.rec[ids[i]].cat, &t); evl_str_addc(&t, '|');
      esc(f.s, &t); evl_str_addc(&t, '|');
      esc(e.s, &t);
      say(t.s);
      evl_str_free(&f); evl_str_free(&e);
    }
    free(a);
  } else if (strcmp(cmd, "LIB.STATS") == 0) {
    long e, c;
    evl_lib_stats(&lib, &e, &c);
    evl_str_add(&t, "ENTRIES "); evl_str_addi(&t, e); evl_str_add(&t, " CHARS "); evl_str_addi(&t, c); say(t.s);
  } else if (strcmp(cmd, "LIB.SAVE") == 0) {
    evl_lib_to_text(&lib, &t);
    evl_write_file(arg, t.s, t.n);
    say("OK");
  } else if (strcmp(cmd, "LIB.LOAD") == 0) {
    if (evl_read_file(arg, &u) != 0) say("FAIL");
    else {
      int n = evl_lib_from_text(&lib, u.s);
      if (n > 0) { evl_str_add(&t, "LOADED "); evl_str_addi(&t, n); say(t.s); } else say("FAIL");
    }
  }

  else if (strcmp(cmd, "NN.LOAD") == 0) {
    if (evl_read_file(arg, &u) != 0) say("ERR");
    else if (evl_model_load(&model, (const unsigned char *)u.s, u.n) != 0) say("ERR");
    else {
      evl_str_add(&t, "MODEL D="); evl_str_addi(&t, model.D); evl_str_add(&t, " L="); evl_str_addi(&t, model.L);
      evl_str_add(&t, " H="); evl_str_addi(&t, model.H); evl_str_add(&t, " HID="); evl_str_addi(&t, model.HID);
      say(t.s);
    }
  } else if (strcmp(cmd, "NN.RESET") == 0) { evl_model_reset(&model); say("PREFIX 0"); }
  else if (strcmp(cmd, "NN.SEED") == 0) {
    long s = atol(arg);
    evl_rng_seed(&model.rng, (evl_u32)s);
    evl_str_add(&t, "SEED "); evl_str_addi(&t, s); say(t.s);
  } else if (strcmp(cmd, "NN.SCORE") == 0) {
    EvlStr clean;
    int p = 0, i, best = 0;
    double sum = 0;
    size_t k;
    unesc(arg, &u);
    evl_str_init(&clean);
    evl_clean_ascii(u.s, &clean);
    for (k = 0; k < clean.n; k++) if (clean.s[k] == '\n') clean.s[k] = ' ';
    for (k = 0; k < clean.n && p < EVL_CTX - 2; k++, p++) evl_model_step(&model, (unsigned char)clean.s[k] - 30, p);
    evl_model_step(&model, 1, p);
    for (i = 0; i < EVL_VOCAB; i++) { if (model.score[i] > model.score[best]) best = i; sum += (double)model.score[i]; }
    evl_str_add(&t, "ARGMAX "); evl_str_addi(&t, best); say(t.s);
    evl_str_clear(&t); evl_str_add(&t, "SCORES ");
    for (i = 0; i < 8; i++) { if (i) evl_str_addc(&t, ' '); num((double)model.score[i], &t); }
    say(t.s);
    evl_str_clear(&t); evl_str_add(&t, "SUM "); num(sum, &t); say(t.s);
    evl_str_free(&clean);
  } else if (strcmp(cmd, "NN.THINK") == 0) {
    char *bar;
    unesc(arg, &u); a = evl_strdup(u.s);
    bar = strchr(a, '|');
    if (!bar) bar = a + strlen(a) - 1;
    *bar = '\0';
    evl_model_think(&model, bar + 1, evl_val_of(a), &t);
    say_esc("OUT ", t.s);
    free(a);
  } else if (strcmp(cmd, "NN.PRIME") == 0) {
    int n;
    unesc(arg, &u);
    n = evl_model_prime(&model, u.s);
    evl_str_add(&t, "PREFIX "); evl_str_addi(&t, n); say(t.s);
  } else if (strcmp(cmd, "NN.KVSAVE") == 0) {
    char *bar;
    unsigned char *b;
    size_t n;
    a = evl_strdup(arg);
    bar = strchr(a, '|');
    if (!bar) bar = a + strlen(a) - 1;
    *bar = '\0';
    n = evl_model_kv_export(&model, atoi(bar + 1), &b);
    evl_write_file(a, (const char *)b, n);
    evl_str_add(&t, "KV BYTES "); evl_str_addi(&t, (long)n); evl_str_add(&t, " SUM ");
    { char h[16]; sprintf(h, "%08lx", (unsigned long)fnv1a(b, n)); evl_str_add(&t, h); }
    say(t.s);
    free(b); free(a);
  } else if (strcmp(cmd, "NN.KVLOAD") == 0) {
    if (evl_read_file(arg, &u) != 0) say("ERR");
    else {
      int n = evl_model_kv_import(&model, (const unsigned char *)u.s, u.n);
      if (n < 0) say("ERR"); else { evl_str_add(&t, "PREFIX "); evl_str_addi(&t, n); say(t.s); }
    }
  }

  else if (strcmp(cmd, "PM.RESET") == 0) { evl_pm_reset(&pm); say("OK"); }
  else if (strcmp(cmd, "PM.MODE") == 0) {
    char c = evl_pm_set_mode(&pm, arg);
    evl_str_add(&t, "MODE "); evl_str_addc(&t, c); say(t.s);
  } else if (strcmp(cmd, "PM.SUCCESS") == 0) {
    char *bar;
    unesc(arg, &u); a = evl_strdup(u.s);
    bar = strchr(a, '|');
    if (bar) { *bar = '\0'; evl_pm_record(&pm, a, (long)floor(evl_val_of(bar + 1))); }
    else evl_pm_record(&pm, a, -1);
    evl_str_add(&t, "XP "); evl_str_addi(&t, pm.xp); say(t.s);
    free(a);
  } else if (strcmp(cmd, "PM.BEST") == 0) {
    evl_str_add(&t, "BEST "); evl_str_addc(&t, evl_pm_best(&pm)); say(t.s);
  } else if (strcmp(cmd, "PM.CFG") == 0) {
    evl_pm_to_cfg(&pm, &u);
    if (u.n && u.s[u.n - 1] == '\n') u.s[--u.n] = '\0';
    say_lines("CFG", u.s);
  } else if (strcmp(cmd, "PM.SAVE") == 0) {
    evl_pm_to_cfg(&pm, &u);
    evl_write_file(arg, u.s, u.n);
    say("OK");
  } else if (strcmp(cmd, "PM.LOAD") == 0) {
    if (evl_read_file(arg, &u) != 0) say("FAIL");
    else { evl_pm_from_cfg(&pm, u.s); say("LOADED"); }
  } else if (strcmp(cmd, "FILE.CAT") == 0) {
    size_t i, j = 0;
    if (evl_read_file(arg, &u) != 0) say("NOFILE");
    else {
      for (i = 0; i < u.n; i++) if (u.s[i] != '\r') u.s[j++] = u.s[i];
      u.n = j; u.s[j] = '\0';
      if (u.n && u.s[u.n - 1] == '\n') u.s[--u.n] = '\0';
      say_lines("FILE", u.s);
    }
  }

  else if (strcmp(cmd, "EXPR") == 0) {
    EvlVal v; EvlVars vars;
    unesc(arg, &u);
    evl_vars_init(&vars);
    evl_eval_expr(u.s, &vars, &v);
    if (v.is_str) { evl_str_add(&t, "EXPR s:"); esc(v.str, &t); } else { evl_str_add(&t, "EXPR n:"); num(v.num, &t); }
    say(t.s);
    evl_val_free(&v); evl_vars_free(&vars);
  } else if (strcmp(cmd, "CODE") == 0) {
    int i;
    EvlVar **order;
    unesc(arg, &u);
    evl_run_code(u.s, &lastrun);
    say(lastrun.ok ? "RESULT OK" : "RESULT ERR");
    if (!lastrun.ok) say_esc("ERROR ", lastrun.error.s);
    for (i = 0; i < lastrun.output.n; i++) say_esc("OUT ", lastrun.output.v[i]);
    if (lastrun.grid.n) say_lines("GRID", lastrun.grid.s);
    order = (EvlVar **)malloc((size_t)(lastrun.vars.n + 1) * sizeof(EvlVar *));
    for (i = 0; i < lastrun.vars.n; i++) order[i] = &lastrun.vars.v[i];
    qsort(order, (size_t)lastrun.vars.n, sizeof(EvlVar *), cmp_var);
    for (i = 0; i < lastrun.vars.n; i++) {
      evl_str_clear(&t);
      evl_str_add(&t, "VAR "); evl_str_add(&t, order[i]->name); evl_str_addc(&t, '=');
      if (order[i]->val.is_str) { evl_str_add(&t, "s:"); esc(order[i]->val.str, &t); }
      else { evl_str_add(&t, "n:"); num(order[i]->val.num, &t); }
      say(t.s);
    }
    free(order);
  }

  else if (strcmp(cmd, "ADV.RESET") == 0) {
    strcpy(pm.room, "camp"); evl_list_clear(&pm.inv); evl_list_clear(&pm.solved); say("OK");
  } else if (strcmp(cmd, "ADV") == 0) {
    unesc(arg, &u);
    evl_adv_command(&pm, &lib, u.s, &t);
    say_lines("ADV", t.s);
  } else if (strcmp(cmd, "ASK") == 0) {
    const char *src;
    unesc(arg, &u);
    if (!evl_last_spoken.s) evl_str_init(&evl_last_spoken);
    evl_str_clear(&evl_last_spoken);
    src = evl_tutor_ask(&lib, &pm, &model, u.s, &t);
    say_lines("ASK", t.s);
    say2("SOURCE ", src);
    evl_str_clear(&t); evl_str_add(&t, "XP "); evl_str_addi(&t, pm.xp); say(t.s);
    evl_str_clear(&t); evl_str_add(&t, "SPOKE "); evl_str_addi(&t, (long)evl_last_spoken.n); say(t.s);
    evl_str_clear(&t); evl_str_add(&t, "MASTERED "); evl_str_addi(&t, pm.mastered.n); say(t.s);
  } else if (strcmp(cmd, "CHIRP") == 0) {
    int f[14], n, i;
    unesc(arg, &u);
    n = evl_chirp_plan(u.s, f);
    evl_str_add(&t, "CHIRP "); evl_str_addi(&t, n); evl_str_addc(&t, ' ');
    for (i = 0; i < n; i++) { if (i) evl_str_addc(&t, ','); evl_str_addi(&t, f[i]); }
    say(t.s);
  }

  else if (strcmp(cmd, "MS.RESET") == 0) { evl_multi_free(&multi); evl_multi_init(&multi); say("OK"); }
  else if (strcmp(cmd, "MS.ADD") == 0) {
    char *f[5]; char empty[1];
    EvlLib *shelf;
    empty[0] = '\0';
    unesc(arg, &u); a = evl_strdup(u.s);
    f[1] = f[2] = f[3] = empty;
    split_bar(a, f, 4);
    shelf = evl_multi_shelf(&multi, f[0]);
    evl_lib_add(shelf, f[1], f[0], f[2], f[3]);
    say("OK");
    free(a);
  } else if (strcmp(cmd, "MS.ASK") == 0) {
    char *bar;
    EvlStr ans, src;
    EvlList chat;
    int i;
    unesc(arg, &u); a = evl_strdup(u.s);
    bar = strchr(a, '|');
    if (!bar) bar = a + strlen(a) - 1;
    *bar = '\0';
    evl_str_init(&ans); evl_str_init(&src); evl_list_init(&chat);
    evl_swarm_ask(&multi, &pm, &model, bar + 1, a, &ans, &src, &chat);
    say_lines("ANSWER", ans.s);
    say_esc("SOURCES ", src.s);
    for (i = 0; i < chat.n; i++) say_esc("CHAT ", chat.v[i]);
    evl_str_free(&ans); evl_str_free(&src); evl_list_free(&chat);
    free(a);
  }

  else if (strcmp(cmd, "NET.FRAME") == 0) {
    double v[16]; int n, id, bt, sq; double x, y, vx, vy; unsigned char b[12];
    numlist(arg, v, &n, 16);
    while (n < 7) v[n++] = 0;
    evl_net_pack_frame(b, (int)v[0], v[1], v[2], v[3], v[4], (int)v[5], (int)v[6]);
    evl_str_add(&t, "HEX "); hex_of(b, 12, &t); say(t.s);
    evl_net_unpack_frame(b, &id, &bt, &sq, &x, &y, &vx, &vy);
    evl_str_clear(&t);
    evl_str_add(&t, "BACK id="); evl_str_addi(&t, id);
    evl_str_add(&t, " x="); num(x, &t); evl_str_add(&t, " y="); num(y, &t);
    evl_str_add(&t, " vx="); num(vx, &t); evl_str_add(&t, " vy="); num(vy, &t);
    evl_str_add(&t, " buttons="); evl_str_addi(&t, bt); evl_str_add(&t, " seq="); evl_str_addi(&t, sq);
    say(t.s);
  } else if (strcmp(cmd, "NET.BRAIN") == 0) {
    double v[256], w[256]; int n, i, m; unsigned char b[300]; size_t bn;
    numlist(arg, v, &n, 256);
    bn = evl_net_pack_brain(v, n, b);
    evl_str_add(&t, "HEX "); hex_of(b, bn, &t); say(t.s);
    m = evl_net_unpack_brain(b, bn, w, 256);
    evl_str_clear(&t); evl_str_add(&t, "BACK ");
    for (i = 0; i < m; i++) { if (i) evl_str_addc(&t, ','); num(w[i], &t); }
    say(t.s);
  } else if (strcmp(cmd, "QDOT") == 0) {
    char *p[4];
    double q[256], kd[256], r;
    signed char k[256];
    int nq, nk, i;
    a = evl_strdup(arg);
    p[0] = a; p[1] = p[2] = (char *)"";
    split_bar(a, p, 3);
    numlist(p[0], q, &nq, 256);
    numlist(p[1], kd, &nk, 256);
    for (i = 0; i < nk; i++) k[i] = (signed char)(int)kd[i];
    r = evl_quant_dot(q, k, 0, evl_val_of(p[2]), nq);
    evl_str_add(&t, "QDOT "); num(r, &t); say(t.s);
    free(a);
  } else {
    say2("UNKNOWN ", cmd);
  }
out:
  evl_str_free(&t); evl_str_free(&u);
  (void)unq;
}

int main(int argc, char **argv)
{
  EvlStr script;
  char *p, *line;
  if (argc < 2) { fputs("usage: evelyn_proto script.txt\n", stderr); return 2; }
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  evl_str_init(&script);
  if (evl_read_file(argv[1], &script) != 0) { fputs("cannot read script\n", stderr); return 2; }
  evl_str_init(&out);
  evl_lib_init(&lib); evl_pm_init(&pm); evl_model_init(&model); evl_multi_init(&multi); evl_run_init(&lastrun);
  say("EVELYN-PROTO 1 c");
  p = script.s;
  while (*p) {
    char *eol = strchr(p, '\n'), *sp;
    size_t len = eol ? (size_t)(eol - p) : strlen(p);
    char *cmd, *arg;
    line = (char *)malloc(len + 1);
    memcpy(line, p, len); line[len] = '\0';
    if (len > 0 && line[len - 1] == '\r') line[--len] = '\0';
    p = eol ? eol + 1 : p + len;
    if (len == 0 || line[0] == '#' || line[0] == '@') { free(line); continue; }
    sp = strchr(line, ' ');
    if (sp) { *sp = '\0'; arg = sp + 1; } else arg = line + len;
    cmd = line;
    if (strcmp(cmd, "QUIT") == 0) { free(line); break; }
    if (sp) *sp = ' ';
    say2(">> ", line);
    if (sp) *sp = '\0';
    do_cmd(cmd, arg);
    free(line);
  }
  fwrite(out.s, 1, out.n, stdout);
  return 0;
}
