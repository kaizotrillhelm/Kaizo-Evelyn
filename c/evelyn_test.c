/* evelyn_test.c - self-checking tests for the C edition. Prints "evelyn c: N passed, M failed". */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "evelyn.h"
#include "evelyn_data.h"

static int passed = 0, failed = 0;

static void check(int ok, const char *what, int line)
{
  if (ok) passed++;
  else { failed++; printf("  FAIL line %d: %s\n", line, what); }
}
#define CHECK(c) check((c), #c, __LINE__)
#define CHECK_STR(a, b) do { const char *a_ = (a), *b_ = (b); if (strcmp(a_, b_) == 0) passed++; else { failed++; printf("  FAIL line %d: \"%s\" != \"%s\"\n", __LINE__, a_, b_); } } while (0)

/* ---------- a small deterministic TNY2 model, built here so the tests need no files ---------- */
static EvlRng trng = { 12345 };
static double rnd(void) { return evl_rng_next(&trng); }

static void put_u16(unsigned char *b, size_t *o, unsigned v) { b[(*o)++] = (unsigned char)(v & 255); b[(*o)++] = (unsigned char)(v >> 8); }
static void put_f32(unsigned char *b, size_t *o, float f) { evl_u32 u; memcpy(&u, &f, 4); b[(*o)++] = (unsigned char)(u & 255); b[(*o)++] = (unsigned char)((u >> 8) & 255); b[(*o)++] = (unsigned char)((u >> 16) & 255); b[(*o)++] = (unsigned char)((u >> 24) & 255); }
static void put_table(unsigned char *b, size_t *o, int rows, int cols, double scale, int small_rows)
{
  int r, c;
  for (r = 0; r < rows; r++) {
    put_f32(b, o, (float)(r < small_rows ? 0.0002 : scale));
    for (c = 0; c < cols; c++) b[(*o)++] = (unsigned char)(signed char)((int)(rnd() * 255) - 127);
  }
}
static void put_gains(unsigned char *b, size_t *o, int n) { int i; for (i = 0; i < n; i++) put_f32(b, o, (float)(0.9 + 0.2 * rnd())); }

static unsigned char *make_model(int D, int L, int H, int HID, unsigned seed, size_t *size)
{
  size_t n = (size_t)evl_tny2_size(D, L, HID), o = 4;
  unsigned char *b = (unsigned char *)malloc(n);
  double sq = 1.0 / (73.0 * sqrt((double)D)), sh = 1.0 / (73.0 * sqrt((double)HID));
  int l;
  evl_rng_seed(&trng, seed);
  memcpy(b, "TNY2", 4);
  put_u16(b, &o, (unsigned)D); put_u16(b, &o, (unsigned)L); put_u16(b, &o, (unsigned)H); put_u16(b, &o, (unsigned)HID);
  put_table(b, &o, EVL_VOCAB, D, 0.002, 2);
  put_table(b, &o, EVL_CTX, D, 0.006, 0);
  for (l = 0; l < L; l++) {
    put_gains(b, &o, D);
    put_table(b, &o, D, D, sq, 0); put_table(b, &o, D, D, sq, 0); put_table(b, &o, D, D, sq, 0); put_table(b, &o, D, D, sq * 2, 0);
    put_gains(b, &o, D);
    put_table(b, &o, HID, D, sq, 0); put_table(b, &o, D, HID, sh * 2, 0);
  }
  put_gains(b, &o, D);
  CHECK(o == n);
  *size = n;
  return b;
}

/* ---------- independent reference LZW (array dictionary, linear search) ---------- */
static int ref_lzw(const char *s, unsigned *codes)
{
  static char dict[4096][64];
  int nd = 256, nc = 0, i, k;
  char w[64];
  size_t wl = 0;
  for (i = 0; i < 256; i++) { dict[i][0] = (char)i; dict[i][1] = '\0'; }
  dict[0][0] = '\1'; /* code 0 is never used for text */
  w[0] = '\0';
  for (i = 0; s[i]; i++) {
    char wc[64];
    int found = -1;
    strcpy(wc, w); wc[wl] = s[i]; wc[wl + 1] = '\0';
    for (k = 1; k < nd; k++) if (strcmp(dict[k], wc) == 0) { found = k; break; }
    if (found >= 0) { strcpy(w, wc); wl++; }
    else {
      for (k = 1; k < nd; k++) if (strcmp(dict[k], w) == 0) { codes[nc++] = (unsigned)k; break; }
      strcpy(dict[nd++], wc);
      w[0] = s[i]; w[1] = '\0'; wl = 1;
    }
  }
  if (wl) for (k = 1; k < nd; k++) if (strcmp(dict[k], w) == 0) { codes[nc++] = (unsigned)k; break; }
  return nc;
}

static void test_text(void)
{
  char b[48];
  EvlStr s;
  EvlList w;
  evl_fmt_num(42, b); CHECK_STR(b, "42");
  evl_fmt_num(-7, b); CHECK_STR(b, "-7");
  evl_fmt_num(3.5, b); CHECK_STR(b, "3.5");
  evl_fmt_num(1.0 / 3.0, b); CHECK_STR(b, "0.333333");
  evl_fmt_num(0.1 + 0.2, b); CHECK_STR(b, "0.3");
  evl_fmt_num(-0.0000001, b); CHECK_STR(b, "0");
  evl_fmt_num(0.0078125, b); CHECK_STR(b, "0.007813");
  evl_fmt_num(1234.5678901, b); CHECK_STR(b, "1234.56789");
  evl_fmt_num(1e12, b); CHECK_STR(b, "1000000000000");
  evl_fmt_num(-2.5, b); CHECK_STR(b, "-2.5");
  CHECK(evl_val_of("42") == 42);
  CHECK(evl_val_of("  -3.5abc") == -3.5);
  CHECK(evl_val_of("abc") == 0);
  CHECK(evl_val_of(".5") == 0.5);
  CHECK(evl_val_of("1e3") == 1);
  evl_str_init(&s);
  evl_clean_ascii("  hello   world  ", &s); CHECK_STR(s.s, "hello world");
  evl_clean_ascii("it\xE2\x80\x99s \xE2\x80\x9Cok\xE2\x80\x9D \xE2\x80\x93 fine", &s); CHECK_STR(s.s, "it's \"ok\" - fine");
  evl_clean_ascii("caf\xC3\xA9", &s); CHECK_STR(s.s, "caf");
  evl_clean_ascii("a\xC3\xA9" "b", &s); CHECK_STR(s.s, "a b");
  evl_clean_ascii("tab\there", &s); CHECK_STR(s.s, "tab here");
  evl_clean_ascii("line1\nline2", &s); CHECK_STR(s.s, "line1\nline2");
  evl_str_free(&s);
  evl_list_init(&w);
  evl_tokenize_words("What is the Gravity of Mars?", &w);
  CHECK(w.n == 2); CHECK_STR(w.v[0], "gravity"); CHECK_STR(w.v[1], "mars");
  evl_list_free(&w);
}

static void test_lzw(void)
{
  const char *samples[] = { "a", "aa", "aaaaaaaaaa", "hello hello hello", "abababababab", "TOBEORNOTTOBEORTOBEORNOT", "Boiling water for 1 minute kills bacteria." };
  int i, j;
  for (i = 0; i < 7; i++) {
    unsigned char *z;
    unsigned ref[64];
    int nref = ref_lzw(samples[i], ref);
    size_t zn = evl_lz_compress(samples[i], &z);
    EvlStr back;
    int same = (int)zn == nref * 2;
    for (j = 0; same && j < nref; j++) if ((unsigned)(z[2 * j] | (z[2 * j + 1] << 8)) != ref[j]) same = 0;
    CHECK(same);
    evl_str_init(&back);
    CHECK(evl_lz_decompress(z, zn, &back) == 0);
    CHECK_STR(back.s, samples[i]);
    evl_str_free(&back); free(z);
  }
  {
    unsigned char bad1[3] = { 1, 2, 3 }, bad2[2] = { 200, 1 }, bad3[4] = { 65, 0, 99, 9 };
    EvlStr o;
    evl_str_init(&o);
    CHECK(evl_lz_decompress(bad1, 3, &o) == -1);
    CHECK(evl_lz_decompress(bad2, 2, &o) == -1);
    CHECK(evl_lz_decompress(bad3, 4, &o) == -1);
    CHECK(evl_lz_decompress(bad1, 0, &o) == 0);
    evl_str_free(&o);
  }
  { /* long repetitive text shrinks, and a long random-ish text round trips */
    EvlStr big, back;
    unsigned char *z;
    size_t zn, i2;
    int rt;
    evl_str_init(&big); evl_str_init(&back);
    for (i2 = 0; i2 < 4000; i2++) evl_str_add(&big, "water ");
    zn = evl_lz_compress(big.s, &z);
    CHECK(zn < big.n / 4);
    rt = evl_lz_decompress(z, zn, &back);
    CHECK(rt == 0 && strcmp(back.s, big.s) == 0);
    free(z);
    evl_str_clear(&big);
    for (i2 = 0; i2 < 20000; i2++) evl_str_addc(&big, 32 + (int)(evl_rng_next(&trng) * 6));
    zn = evl_lz_compress(big.s, &z);
    evl_str_clear(&back);
    rt = evl_lz_decompress(z, zn, &back);
    CHECK(rt == 0 && strcmp(back.s, big.s) == 0);
    free(z); evl_str_free(&big); evl_str_free(&back);
  }
}

static void test_base64(void)
{
  EvlStr e;
  unsigned char *d;
  size_t n;
  evl_str_init(&e);
  evl_b64_encode((const unsigned char *)"Man", 3, &e); CHECK_STR(e.s, "TWFu");
  evl_str_clear(&e); evl_b64_encode((const unsigned char *)"Ma", 2, &e); CHECK_STR(e.s, "TWE=");
  evl_str_clear(&e); evl_b64_encode((const unsigned char *)"M", 1, &e); CHECK_STR(e.s, "TQ==");
  evl_str_clear(&e); evl_b64_encode((const unsigned char *)"", 0, &e); CHECK_STR(e.s, "");
  n = evl_b64_decode("TWFuTWE=", &d); CHECK(n == 5 && memcmp(d, "ManMa", 5) == 0); free(d);
  n = evl_b64_decode("TQ==", &d); CHECK(n == 1 && d[0] == 'M'); free(d);
  evl_str_free(&e);
}

static void test_library(void)
{
  EvlLib lib, l2;
  int ids[3], n;
  long ent, ch;
  EvlStr f, x, text;
  evl_lib_init(&lib); evl_lib_starter(&lib);
  evl_lib_stats(&lib, &ent, &ch); CHECK(ent == 16);
  n = evl_lib_search(&lib, "how do I purify water", 2, ids);
  CHECK(n == 2 && ids[0] == 0 && ids[1] == 1);
  evl_str_init(&f); evl_str_init(&x);
  evl_lib_read(&lib, 0, &f, &x);
  CHECK(strncmp(f.s, "Boiling water", 13) == 0);
  CHECK_STR(lib.rec[0].topic, "water purification");
  CHECK(evl_lib_search(&lib, "the of a", 3, ids) == 0);
  CHECK(evl_lib_search(&lib, "nothing here", 3, ids) == 0);

  evl_lib_init(&l2);
  evl_lib_add(&l2, "zebra", "x", "an animal with stripes", "");
  evl_lib_add(&l2, "stripes", "x", "a pattern of lines", "");
  evl_lib_add(&l2, "pattern", "x", "stripes and dots", "");
  n = evl_lib_search(&l2, "stripes", 3, ids);
  CHECK(n == 3 && ids[0] == 1 && ids[1] == 0 && ids[2] == 2);
  evl_lib_free(&l2);

  /* one topic word (3) beats two fact words (1 + 1), and a tie goes to the lower id */
  evl_lib_init(&l2);
  evl_lib_add(&l2, "filler", "x", "red and blue paint", "");
  evl_lib_add(&l2, "red", "x", "a colour", "");
  n = evl_lib_search(&l2, "red blue", 2, ids);
  CHECK(n == 2 && ids[0] == 1 && ids[1] == 0);
  evl_lib_free(&l2);
  evl_lib_init(&l2);
  evl_lib_add(&l2, "one", "x", "shared word here", "");
  evl_lib_add(&l2, "two", "x", "shared word there", "");
  n = evl_lib_search(&l2, "shared", 2, ids);
  CHECK(n == 2 && ids[0] == 0 && ids[1] == 1);
  evl_lib_free(&l2);

  evl_lib_init(&l2);
  n = evl_lib_ingest(&l2, "The camel stores fat in its hump and can go a long time without water in the desert.\n\nshort\n\nThe camel stores fat in its hump and can go a long time without water in the desert. The camel stores fat in its hump and can go a long time without water in the desert.", "book");
  CHECK(n == 3);
  CHECK_STR(l2.rec[0].topic, "The camel stores"); CHECK_STR(l2.rec[0].cat, "book");
  evl_lib_free(&l2);

  evl_str_init(&text);
  evl_lib_to_text(&lib, &text);
  evl_lib_init(&l2);
  CHECK(evl_lib_from_text(&l2, text.s) == 16);
  n = evl_lib_search(&l2, "gravity", 1, ids);
  CHECK(n == 1 && strcmp(l2.rec[ids[0]].topic, "gravity") == 0);
  { EvlStr again; evl_str_init(&again); evl_lib_to_text(&l2, &again); CHECK_STR(again.s, text.s); evl_str_free(&again); }
  evl_lib_free(&l2); evl_lib_free(&lib);
  evl_str_free(&f); evl_str_free(&x); evl_str_free(&text);
}

static void test_model(void)
{
  size_t sz, kvn;
  unsigned char *buf = make_model(24, 2, 4, 48, 2026, &sz), *kv;
  EvlModel a, b, c;
  EvlStr o1, o2;
  int i, p, finite = 1, rc;
  evl_model_init(&a); evl_model_init(&b); evl_model_init(&c);
  CHECK(evl_model_load(&a, buf, sz) == 0);
  CHECK(a.D == 24 && a.L == 2 && a.H == 4 && a.HID == 48 && a.HD == 6);
  buf[0] = 'X'; CHECK(evl_model_load(&c, buf, sz) == 1); buf[0] = 'T';
  CHECK(evl_model_load(&c, buf, sz - 10) == 3);
  CHECK(evl_model_load(&c, buf, 4) == 1);
  buf[8] = 5; CHECK(evl_model_load(&c, buf, sz) == 2); buf[8] = 4;
  CHECK(evl_model_load(&b, buf, sz) == 0);

  for (p = 0; p < 10; p++) { evl_model_step(&a, 30 + p, p); evl_model_step(&b, 30 + p, p); }
  for (i = 0; i < EVL_VOCAB; i++) if (!(fabs((double)a.score[i]) < 1e6) || a.score[i] != b.score[i]) finite = 0;
  CHECK(finite);

  evl_str_init(&o1); evl_str_init(&o2);
  evl_model_reset(&a);
  evl_model_think(&a, "what is gravity", 0, &o1);
  evl_model_think(&a, "what is gravity", 0, &o2);
  CHECK(o1.n > 20); CHECK_STR(o1.s, o2.s);
  evl_model_think(&a, "hello", 0, &o2);
  CHECK(strcmp(o1.s, o2.s) != 0);

  /* pick: greedy takes the first maximum; sampling is repeatable with the same seed */
  for (i = 0; i < EVL_VOCAB; i++) a.score[i] = -5.0f;
  a.score[7] = 3.0f; a.score[40] = 3.0f;
  CHECK(evl_model_pick(&a, 0) == 7);
  a.score[7] = 1.0f; a.score[40] = 2.0f;
  { int s1[20], s2[20], same = 1, only = 1;
    evl_rng_seed(&a.rng, 5);
    for (i = 0; i < 20; i++) s1[i] = evl_model_pick(&a, 3);
    evl_rng_seed(&a.rng, 5);
    for (i = 0; i < 20; i++) s2[i] = evl_model_pick(&a, 3);
    for (i = 0; i < 20; i++) { if (s1[i] != s2[i]) same = 0; if (s1[i] != 7 && s1[i] != 40) only = 0; }
    CHECK(same); CHECK(only);
  }

  /* KV21: a primed prefix exported from one model continues exactly in another */
  evl_model_reset(&a); evl_model_reset(&b);
  CHECK(evl_model_prime(&a, "SECRET:PIN=4921;") == 16);
  kvn = evl_model_kv_export(&a, 16, &kv);
  CHECK(kvn == 10 + 2 * 16 * 2 * (4 + 24));
  CHECK(memcmp(kv, "KV21", 4) == 0 && kv[4] == 24 && kv[6] == 2 && kv[8] == 16);
  CHECK(evl_model_kv_import(&b, kv, kvn) == 16);
  evl_model_think(&a, "Q:PIN?A:", 0, &o1);
  evl_model_think(&b, "Q:PIN?A:", 0, &o2);
  CHECK(o1.n > 0); CHECK_STR(o1.s, o2.s);
  evl_model_reset(&c);
  CHECK(evl_model_load(&c, buf, sz) == 0);
  evl_model_think(&c, "Q:PIN?A:", 0, &o2);
  CHECK(strcmp(o1.s, o2.s) != 0);
  kv[0] = 0; CHECK(evl_model_kv_import(&b, kv, kvn) == -1); kv[0] = 'K';
  CHECK(evl_model_kv_import(&b, kv, 40) == -1);
  CHECK(evl_model_kv_import(&b, kv, 5) == -1);
  free(kv);
  rc = evl_model_prime(&c, "abc"); CHECK(rc > 0);
  evl_model_reset(&c); CHECK(c.kv_prefix == 0);

  evl_str_free(&o1); evl_str_free(&o2);
  evl_model_free(&a); evl_model_free(&b); evl_model_free(&c);
  free(buf);
  { /* full size shape loads and answers */
    unsigned char *big = make_model(96, 4, 4, 256, 99, &sz);
    EvlModel m; EvlStr o;
    evl_model_init(&m); evl_str_init(&o);
    CHECK(evl_model_load(&m, big, sz) == 0);
    evl_model_think(&m, "what is water", 0, &o);
    CHECK(o.n > 5);
    evl_str_free(&o); evl_model_free(&m); free(big);
  }
}

static void test_profile(void)
{
  EvlProfile p, q;
  EvlStr cfg, cfg2;
  evl_pm_init(&p); evl_pm_init(&q);
  CHECK(evl_pm_set_mode(&p, "a") == 'A');
  CHECK(evl_pm_set_mode(&p, "zzz") == 'A');
  CHECK(evl_pm_set_mode(&p, "") == 'M');
  evl_pm_set_mode(&p, "D");
  evl_pm_record(&p, "fractions", -1); evl_pm_record(&p, "fractions", -1); evl_pm_record(&p, "gravity", 25);
  CHECK(p.xp == 45); CHECK(p.mastered.n == 2); CHECK(p.fb[2] == 3); CHECK(evl_pm_best(&p) == 'D');
  evl_pm_reset(&q); CHECK(evl_pm_best(&q) == 'M');
  strcpy(p.name, "Leo"); strcpy(p.room, "well");
  evl_list_add(&p.solved, "p_solar"); evl_list_add(&p.inv, "Clean Canteen (+20 XP)"); evl_list_add(&p.recent, "what is up?");
  evl_pm_record(&p, "a|b topic", -1);
  evl_str_init(&cfg); evl_str_init(&cfg2);
  evl_pm_to_cfg(&p, &cfg);
  evl_pm_from_cfg(&q, cfg.s);
  CHECK_STR(q.name, "Leo"); CHECK(q.mode == 'D'); CHECK(q.xp == 55); CHECK_STR(q.room, "well");
  CHECK(q.mastered.n == 3); CHECK_STR(q.mastered.v[2], "a b topic");
  CHECK(q.solved.n == 1 && q.inv.n == 1 && q.recent.n == 1);
  evl_pm_to_cfg(&q, &cfg2);
  CHECK_STR(cfg.s, cfg2.s);
  evl_pm_from_cfg(&q, "MODE=Q\nXP=abc\ngarbage\n=x\nNAME=\n");
  CHECK(q.mode == 'M'); CHECK(q.xp == 0); CHECK_STR(q.name, "Explorer");
  evl_str_free(&cfg); evl_str_free(&cfg2); evl_pm_free(&p); evl_pm_free(&q);
}

static void test_audio(void)
{
  int f[14], n;
  n = evl_chirp_plan("A B", f);
  CHECK(n == 3 && f[0] == 280 + (65 % 24) * 35 && f[1] == 0 && f[2] == 280 + (66 % 24) * 35);
  CHECK(evl_chirp_plan("this text is longer than fourteen", f) == 14);
  evl_audio_speak("hi", 'R'); CHECK(evl_last_spoken.s == NULL || evl_last_spoken.n == 0);
  evl_audio_speak("hi", 'A'); CHECK_STR(evl_last_spoken.s, "hi");
}

static const char *run_out(EvlRun *r, int i) { return r->output.v[i]; }

static void test_sandbox(void)
{
  EvlRun r;
  EvlVal v;
  EvlVars vars;
  struct { const char *e; double n; } nums[] = {
    { "2 + 3 * 4", 14 }, { "(2 + 3) * 4", 20 }, { "-3 + 5", 2 }, { "7 / 2", 3.5 }, { "7 % 4", 3 }, { "-7 % 4", -3 },
    { "5 / 0", 0 }, { "5 % 0", 0 }, { "3 < 4", 1 }, { "3 >= 4", 0 }, { "3 == 3", 1 }, { "3 = 3", 1 }, { "3 != 3", 0 },
    { "\"abc\" < \"abd\"", 1 }, { "\"b\" == \"b\"", 1 }, { "\"3\" * 2", 6 }, { "unknown + 1", 1 }, { "", 0 }, { "(1 + 2", 3 }, { "1.5 * 2", 3 }
  };
  int i;
  evl_vars_init(&vars);
  for (i = 0; i < (int)(sizeof(nums) / sizeof(nums[0])); i++) {
    evl_eval_expr(nums[i].e, &vars, &v);
    check(!v.is_str && v.num == nums[i].n, nums[i].e, __LINE__);
    evl_val_free(&v);
  }
  evl_eval_expr("\"a\" + \"b\"", &vars, &v); CHECK(v.is_str && strcmp(v.str, "ab") == 0); evl_val_free(&v);
  evl_eval_expr("\"a\" + 5", &vars, &v); CHECK(v.is_str && strcmp(v.str, "a5") == 0); evl_val_free(&v);
  evl_eval_expr("5 + \"a\"", &vars, &v); CHECK(v.is_str && strcmp(v.str, "5a") == 0); evl_val_free(&v);
  evl_vars_free(&vars);

  evl_run_init(&r);
  evl_run_code(EVL_LESSONS[0][2], &r); CHECK(r.ok && r.output.n == 1 && strcmp(run_out(&r, 0), "HELLO OASIS") == 0);
  evl_run_code(EVL_LESSONS[1][2], &r); CHECK(r.ok && strcmp(run_out(&r, 0), "42") == 0);
  evl_run_code(EVL_LESSONS[3][2], &r); CHECK(r.ok && strcmp(run_out(&r, 0), "FIND WELL") == 0);
  evl_run_code(EVL_LESSONS[2][2], &r);
  CHECK(r.ok && strstr(r.grid.s, ". . . . @ # # # . . . .\n. . . . # . . # . . . .") != NULL);
  evl_run_code("LET Total = 0\nREPEAT 5\nLET total = TOTAL + 2\nEND\nPRINT TOTAL", &r);
  CHECK(r.ok && strcmp(run_out(&r, 0), "10") == 0);
  evl_run_code("REPEAT 0\nPRINT \"never\"\nEND\nPRINT \"after\"", &r);
  CHECK(r.ok && r.output.n == 1 && strcmp(run_out(&r, 0), "after") == 0);
  evl_run_code("REPEAT 2\nREPEAT 3\nPRINT \"x\"\nEND\nEND", &r); CHECK(r.ok && r.output.n == 6);
  evl_run_code("LET n = \"Leo\"\nPRINT \"Hi \" + n\nIF n == \"Leo\" THEN PRINT \"yes\"\nIF n == \"Bo\" THEN PRINT \"no\"\nIF 1 = 1 THEN LET z = 9\nPRINT z / 4", &r);
  CHECK(r.ok && r.output.n == 3 && strcmp(run_out(&r, 0), "Hi Leo") == 0 && strcmp(run_out(&r, 1), "yes") == 0 && strcmp(run_out(&r, 2), "2.25") == 0);
  evl_run_code("END", &r); CHECK(!r.ok); CHECK_STR(r.error.s, "Line 1: END without REPEAT");
  evl_run_code("REPEAT 2\nPRINT 1", &r); CHECK_STR(r.error.s, "Missing END for REPEAT");
  evl_run_code("DANCE", &r); CHECK_STR(r.error.s, "Line 1: Unknown command 'DANCE'");
  evl_run_code("PRINT 1\nIF 1 PRINT 2", &r); CHECK_STR(r.error.s, "Line 2: IF needs THEN");
  evl_run_code("LET x 5", &r); CHECK_STR(r.error.s, "Line 1: LET needs '='");
  evl_run_code("LET 5x = 1", &r); CHECK_STR(r.error.s, "Line 1: bad variable name '5x'");
  evl_run_code("REPEAT 1000\nPRINT 1\nEND", &r); CHECK_STR(r.error.s, "Stopped after 500 steps (loop limit)"); CHECK(r.grid.n > 0);
  evl_run_code("PRINT", &r); CHECK_STR(r.error.s, "Line 1: Unknown command 'PRINT'");
  evl_run_code("CLEAR\nMOVE 1", &r); CHECK(strstr(r.grid.s, ". . . . # @ . . . . . .") != NULL);
  evl_run_code("# a comment\n\nPRINT 1", &r); CHECK(r.ok && strcmp(run_out(&r, 0), "1") == 0);
  evl_run_code("MOVE 50\nTURN LEFT\nMOVE 20\nTURN RIGHT\nTURN LEFT\nMOVE -3", &r); CHECK(r.ok);
  evl_run_free(&r);
}

static void test_adventure_and_tutor(void)
{
  EvlLib lib; EvlProfile pm; EvlStr o, t;
  EvlModel none;
  const char *src;
  int i;
  evl_lib_init(&lib); evl_lib_starter(&lib); evl_pm_init(&pm); evl_str_init(&o); evl_str_init(&t); evl_model_init(&none);

  evl_adv_look(&pm, &o); CHECK(strncmp(o.s, "== Solar Camp ==", 16) == 0);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "go south", &o); CHECK(strncmp(o.s, "You can't go 'south'. Exits: east, north", 40) == 0);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "not sure", &o); CHECK(strncmp(o.s, "Not quite!", 10) == 0);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "HINT", &o); CHECK(strncmp(o.s, "[Library Hint - water purification] Boiling water", 49) == 0);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "ANSWER boil it and strain through cloth", &o);
  CHECK_STR(o.s, "CORRECT! Unlocked: Clean Canteen (+20 XP)\nXP: 20");
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "boil", &o);
  CHECK_STR(o.s, "CORRECT! Unlocked: Clean Canteen (+20 XP)\nXP: 20");
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "GO east", &o); CHECK(strncmp(o.s, "== The Dry Well & Builder's Corner ==", 37) == 0);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "it is 5", &o); CHECK(strstr(o.s, "Brass Key") != NULL);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "go south", &o); CHECK(strstr(o.s, "Underground Library Vault") != NULL);
  evl_str_clear(&o); evl_adv_command(&pm, &lib, "0.75", &o); CHECK(strstr(o.s, "Master Oasis Key (+50 XP)") != NULL);
  CHECK(pm.xp == 90); CHECK(pm.solved.n == 3); CHECK(pm.mastered.n == 3);

  evl_pm_reset(&pm);
  src = evl_tutor_ask(&lib, &pm, &none, "what is 18*4", &t);
  CHECK_STR(t.s, "[MIX] 18*4 = 72\nApplied Example: If you split or group 18*4, the result is 72."); CHECK_STR(src, "Compressed Library");
  evl_str_clear(&t); evl_tutor_ask(&lib, &pm, &none, "7 / 2 ?", &t); CHECK(strncmp(t.s, "[MIX] 7 / 2 = 3.5", 17) == 0);
  {
    const char *modes = "RADM";
    const char *expect[4] = { "[READ] GRAVITY\n", "[AUDIO] Gravity pulls", "[DO] Try applying 'gravity':\nAction: Drop a pebble", "[MIX] Gravity pulls" };
    for (i = 0; i < 4; i++) {
      char m[2];
      m[0] = modes[i]; m[1] = '\0';
      evl_pm_set_mode(&pm, m);
      evl_str_clear(&t);
      evl_tutor_ask(&lib, &pm, &none, "tell me about gravity", &t);
      check(strncmp(t.s, expect[i], strlen(expect[i])) == 0, expect[i], __LINE__);
    }
  }
  evl_str_clear(&t);
  src = evl_tutor_ask(&lib, &pm, &none, "zzzz qqqq", &t);
  CHECK_STR(src, "Offline Guide"); CHECK(strncmp(t.s, "I could not find 'zzzz qqqq'", 28) == 0);
  for (i = 0; i < 30; i++) { evl_str_clear(&t); evl_tutor_ask(&lib, &pm, &none, "hello there", &t); }
  CHECK(pm.recent.n == 20);
  evl_str_free(&o); evl_str_free(&t); evl_pm_free(&pm); evl_lib_free(&lib);
}

static void test_multi(void)
{
  EvlMulti m; EvlProfile pm; EvlLib *s;
  EvlStr ans, src; EvlList chat;
  evl_multi_init(&m); evl_pm_init(&pm); evl_str_init(&ans); evl_str_init(&src); evl_list_init(&chat);
  s = evl_multi_shelf(&m, "stem");
  evl_lib_add(s, "triangle", "stem", "A right triangle with sides 3 and 4 has a diagonal of 5.", "Use a rope.");
  s = evl_multi_shelf(&m, "civics");
  evl_lib_add(s, "triangle vote", "civics", "A vote of 2 out of 3 members passes a motion.", "");
  evl_swarm_ask(&m, &pm, NULL, "triangle", "stem", &ans, &src, &chat);
  CHECK_STR(src.s, "[stem#0: triangle]");
  CHECK(strstr(ans.s, "diagonal of 5. (Example: Use a rope.) [stem#0]") != NULL);
  CHECK_STR(chat.v[1], "Checker: VERIFIED against [stem#0: triangle]");
  evl_list_clear(&chat);
  evl_swarm_ask(&m, &pm, NULL, "triangle", "*", &ans, &src, &chat);
  CHECK_STR(src.s, "[stem#0: triangle] [civics#0: triangle vote]");
  evl_list_clear(&chat);
  evl_swarm_ask(&m, &pm, NULL, "zzzz", "*", &ans, &src, &chat);
  CHECK_STR(ans.s, "No verified source found across shelves. Try importing a .txt module for this topic.");
  CHECK_STR(chat.v[1], "Checker: REJECTED - no matching source in persistent library.");
  evl_str_free(&ans); evl_str_free(&src); evl_list_free(&chat); evl_multi_free(&m); evl_pm_free(&pm);
}

static void test_net(void)
{
  unsigned char f[12], br[64];
  int id, bt, sq, i;
  double x, y, vx, vy, w[8], back[8];
  size_t n;
  evl_net_pack_frame(f, 7, 12.5, -3.25, 1.5, -0.5, 5, 513);
  evl_net_unpack_frame(f, &id, &bt, &sq, &x, &y, &vx, &vy);
  CHECK(id == 7 && bt == 5 && sq == 513 && x == 12.5 && y == -3.25 && vx == 1.5 && vy == -0.5);
  evl_net_pack_frame(f, 300, 9999, -9999, 999, -999, 300, 70000);
  evl_net_unpack_frame(f, &id, &bt, &sq, &x, &y, &vx, &vy);
  CHECK(id == 44 && bt == 44 && sq == 4464 && x == 32767 / 16.0 && y == -32768 / 16.0 && vx == 32767 / 256.0 && vy == -32768 / 256.0);
  w[0] = 0.5; w[1] = -0.25; w[2] = 1.0; w[3] = 0.0; w[4] = -1.0; w[5] = 0.123;
  n = evl_net_pack_brain(w, 6, br); CHECK(n == 12);
  CHECK(evl_net_unpack_brain(br, n, back, 8) == 6);
  for (i = 0; i < 6; i++) CHECK(fabs(back[i] - w[i]) < 1.0 / 127 + 1e-6);
  {
    double q[2]; signed char k[2];
    q[0] = 127; q[1] = -127; k[0] = 2; k[1] = 3;
    CHECK(evl_quant_dot(q, k, 0, 1.0, 2) == -127.0);
    q[0] = 0; q[1] = 0; CHECK(evl_quant_dot(q, k, 0, 1.0, 2) == 0.0);
  }
}

int main(void)
{
  test_text();
  test_lzw();
  test_base64();
  test_library();
  test_model();
  test_profile();
  test_audio();
  test_sandbox();
  test_adventure_and_tutor();
  test_multi();
  test_net();
  printf("evelyn c: %d passed, %d failed\n", passed, failed);
  return failed ? 1 : 0;
}
