/* evelyn.c - Evelyn and her Echoes, C edition. See evelyn.h. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ctype.h>
#include "evelyn.h"
#include "evelyn_data.h"

/* ======================================================================
   memory, strings, lists, files
   ====================================================================== */
static void *evl_alloc(size_t n)
{
  void *p = malloc(n ? n : 1);
  if (!p) { fputs("evelyn: out of memory\n", stderr); exit(1); }
  return p;
}

static void *evl_grow(void *q, size_t n)
{
  void *p = realloc(q, n ? n : 1);
  if (!p) { fputs("evelyn: out of memory\n", stderr); exit(1); }
  return p;
}

char *evl_strdup(const char *s)
{
  size_t n = strlen(s);
  char *p = (char *)evl_alloc(n + 1);
  memcpy(p, s, n + 1);
  return p;
}

static char *evl_strndup(const char *s, size_t n)
{
  char *p = (char *)evl_alloc(n + 1);
  memcpy(p, s, n);
  p[n] = '\0';
  return p;
}

void evl_str_init(EvlStr *b) { b->cap = 32; b->s = (char *)evl_alloc(b->cap); b->s[0] = '\0'; b->n = 0; }
void evl_str_free(EvlStr *b) { free(b->s); b->s = NULL; b->n = 0; b->cap = 0; }
void evl_str_clear(EvlStr *b) { b->n = 0; b->s[0] = '\0'; }

void evl_str_addn(EvlStr *b, const char *s, size_t n)
{
  if (b->n + n + 1 > b->cap) {
    while (b->n + n + 1 > b->cap) b->cap *= 2;
    b->s = (char *)evl_grow(b->s, b->cap);
  }
  memcpy(b->s + b->n, s, n);
  b->n += n;
  b->s[b->n] = '\0';
}
void evl_str_add(EvlStr *b, const char *s) { evl_str_addn(b, s, strlen(s)); }
void evl_str_addc(EvlStr *b, int c) { char ch = (char)c; evl_str_addn(b, &ch, 1); }
void evl_str_addi(EvlStr *b, long v) { char tmp[32]; sprintf(tmp, "%ld", v); evl_str_add(b, tmp); }

void evl_list_init(EvlList *l) { l->v = NULL; l->n = 0; l->cap = 0; }
void evl_list_clear(EvlList *l)
{
  int i;
  for (i = 0; i < l->n; i++) free(l->v[i]);
  l->n = 0;
}
void evl_list_free(EvlList *l) { evl_list_clear(l); free(l->v); l->v = NULL; l->cap = 0; }
void evl_list_add(EvlList *l, const char *s)
{
  if (l->n == l->cap) {
    l->cap = l->cap ? l->cap * 2 : 8;
    l->v = (char **)evl_grow(l->v, (size_t)l->cap * sizeof(char *));
  }
  l->v[l->n++] = evl_strdup(s);
}
int evl_list_has(const EvlList *l, const char *s)
{
  int i;
  for (i = 0; i < l->n; i++) if (strcmp(l->v[i], s) == 0) return 1;
  return 0;
}
void evl_list_drop_first(EvlList *l)
{
  int i;
  if (l->n == 0) return;
  free(l->v[0]);
  for (i = 1; i < l->n; i++) l->v[i - 1] = l->v[i];
  l->n--;
}
void evl_list_join(const EvlList *l, EvlStr *out)
{
  int i;
  const char *p;
  for (i = 0; i < l->n; i++) {
    if (i) evl_str_addc(out, '|');
    for (p = l->v[i]; *p; p++) evl_str_addc(out, (*p == '|' || *p == '\r' || *p == '\n') ? ' ' : *p);
  }
}
void evl_list_split(EvlList *l, const char *s)
{
  const char *start = s, *p;
  evl_list_clear(l);
  if (!*s) return;
  for (p = s; ; p++) {
    if (*p == '|' || *p == '\0') {
      char *item = evl_strndup(start, (size_t)(p - start));
      evl_list_add(l, item);
      free(item);
      start = p + 1;
      if (*p == '\0') break;
    }
  }
}

int evl_read_file(const char *path, EvlStr *out)
{
  FILE *f = fopen(path, "rb");
  char buf[4096];
  size_t n;
  if (!f) return -1;
  while ((n = fread(buf, 1, sizeof(buf), f)) > 0) evl_str_addn(out, buf, n);
  fclose(f);
  return 0;
}
int evl_write_file(const char *path, const char *data, size_t n)
{
  FILE *f = fopen(path, "wb");
  if (!f) return -1;
  fwrite(data, 1, n, f);
  fclose(f);
  return 0;
}

/* ======================================================================
   text helpers
   ====================================================================== */
void evl_fmt_num(double x, char *out)
{
  int neg;
  double a, scaled, ip, fp;
  char tmp[48], frac[16];
  int len;
  if (x != x) { strcpy(out, "NaN"); return; }
  if (x > 1.7e308) { strcpy(out, "Infinity"); return; }
  if (x < -1.7e308) { strcpy(out, "-Infinity"); return; }
  neg = x < 0;
  a = neg ? -x : x;
  if (floor(a) == a && a < 1e15) {
    sprintf(tmp, "%.0f", a);
  } else {
    scaled = floor(a * 1e6 + 0.5);
    ip = floor(scaled / 1e6);
    fp = scaled - ip * 1e6;
    sprintf(tmp, "%.0f", ip);
    if (fp > 0) {
      sprintf(frac, "%06.0f", fp);
      len = (int)strlen(frac);
      while (len > 0 && frac[len - 1] == '0') frac[--len] = '\0';
      strcat(tmp, ".");
      strcat(tmp, frac);
    }
  }
  if (strcmp(tmp, "0") == 0) { strcpy(out, "0"); return; }
  if (neg) { out[0] = '-'; strcpy(out + 1, tmp); } else strcpy(out, tmp);
}

/* spaces, sign, digits with a fraction; the rest is ignored */
static double evl_parse_decimal(const char *s, int *used)
{
  double n = 0.0, scale = 1.0;
  const char *p = s;
  int digits = 0;
  while (isdigit((unsigned char)*p)) { n = n * 10.0 + (*p - '0'); p++; digits++; }
  if (*p == '.' && isdigit((unsigned char)p[1])) {
    p++;
    while (isdigit((unsigned char)*p)) { n = n * 10.0 + (*p - '0'); scale *= 10.0; p++; digits++; }
  }
  if (used) *used = digits ? (int)(p - s) : 0;
  return n / scale;
}

double evl_val_of(const char *s)
{
  int neg = 0, used = 0;
  double v;
  while (*s == ' ') s++;
  if (*s == '+' || *s == '-') { neg = (*s == '-'); s++; }
  v = evl_parse_decimal(s, &used);
  if (!used) return 0.0;
  return neg ? -v : v;
}

void evl_clean_ascii(const char *in, EvlStr *out)
{
  EvlStr tmp;
  size_t i = 0, a, b, n;
  evl_str_init(&tmp);
  while (in[i]) {
    unsigned char c = (unsigned char)in[i];
    if (c < 128) {
      if ((c >= 32 && c <= 126) || c == '\n') evl_str_addc(&tmp, c); else evl_str_addc(&tmp, ' ');
      i++;
    } else {
      int len;
      if (c == 0xE2 && (unsigned char)in[i + 1] == 0x80 && in[i + 2]) {
        unsigned char d = (unsigned char)in[i + 2];
        if (d == 0x98 || d == 0x99) { evl_str_addc(&tmp, '\''); i += 3; continue; }
        if (d == 0x9C || d == 0x9D) { evl_str_addc(&tmp, '"'); i += 3; continue; }
        if (d == 0x93 || d == 0x94) { evl_str_addc(&tmp, '-'); i += 3; continue; }
      }
      len = c >= 0xF0 ? 4 : (c >= 0xE0 ? 3 : (c >= 0xC0 ? 2 : 1));
      i++;
      while (len > 1 && in[i] && ((unsigned char)in[i] & 0xC0) == 0x80) { i++; len--; }
      evl_str_addc(&tmp, ' ');
    }
  }
  /* runs of spaces become one space, then trim spaces and newlines at both ends */
  n = tmp.n;
  evl_str_clear(out);
  for (i = 0; i < n; i++) {
    if (tmp.s[i] == ' ' && i + 1 < n && tmp.s[i + 1] == ' ') continue;
    evl_str_addc(out, tmp.s[i]);
  }
  a = 0; b = out->n;
  while (a < b && (out->s[a] == ' ' || out->s[a] == '\n')) a++;
  while (b > a && (out->s[b - 1] == ' ' || out->s[b - 1] == '\n')) b--;
  if (a > 0 || b < out->n) {
    memmove(out->s, out->s + a, b - a);
    out->n = b - a;
    out->s[out->n] = '\0';
  }
  evl_str_free(&tmp);
}

static const char *const EVL_STOP[] = {
  "a", "an", "the", "is", "are", "was", "were", "of", "in", "on", "to", "for", "and", "or", "it", "its",
  "what", "which", "who", "where", "when", "how", "do", "does", "did", "can", "you", "me", "tell", "about", NULL
};
static int evl_is_stop(const char *w)
{
  int i;
  for (i = 0; EVL_STOP[i]; i++) if (strcmp(EVL_STOP[i], w) == 0) return 1;
  return 0;
}

void evl_tokenize_words(const char *text, EvlList *out)
{
  size_t i = 0, start;
  evl_list_clear(out);
  while (text[i]) {
    unsigned char c = (unsigned char)text[i];
    if (isalnum(c) && c < 128) {
      char *w;
      size_t k;
      start = i;
      while (text[i] && (unsigned char)text[i] < 128 && isalnum((unsigned char)text[i])) i++;
      w = evl_strndup(text + start, i - start);
      for (k = 0; w[k]; k++) w[k] = (char)tolower((unsigned char)w[k]);
      if (!evl_is_stop(w)) evl_list_add(out, w);
      free(w);
    } else i++;
  }
}

void evl_rng_seed(EvlRng *r, evl_u32 seed) { r->state = seed ? seed : (evl_u32)2463534242UL; }
double evl_rng_next(EvlRng *r)
{
  evl_u32 x = r->state;
  x ^= (x << 13) & 0xFFFFFFFFUL;
  x ^= x >> 17;
  x ^= (x << 5) & 0xFFFFFFFFUL;
  r->state = x;
  return (double)x / 4294967296.0;
}

/* ======================================================================
   LZW (16-bit little endian codes) and base64
   ====================================================================== */
#define EVL_LZ_MAX 65535UL
#define EVL_HASH 131072UL

size_t evl_lz_compress(const char *in, unsigned char **out)
{
  size_t len = strlen(in), i, no = 0;
  unsigned long *keys = (unsigned long *)evl_alloc(EVL_HASH * sizeof(unsigned long));
  unsigned short *vals = (unsigned short *)evl_alloc(EVL_HASH * sizeof(unsigned short));
  unsigned char *o = (unsigned char *)evl_alloc(len * 2 + 2);
  unsigned long next_code = 256, key, h;
  long w = -1;
  for (i = 0; i < EVL_HASH; i++) keys[i] = 0xFFFFFFFFUL;
  for (i = 0; i < len; i++) {
    unsigned char c = (unsigned char)in[i];
    if (w < 0) { w = c; continue; }
    key = ((unsigned long)w << 8) | c;
    h = (key * 40503UL + (key >> 9)) & (EVL_HASH - 1);
    while (keys[h] != 0xFFFFFFFFUL && keys[h] != key) h = (h + 1) & (EVL_HASH - 1);
    if (keys[h] == key) {
      w = vals[h];
    } else {
      o[no++] = (unsigned char)(w & 255); o[no++] = (unsigned char)((w >> 8) & 255);
      if (next_code < EVL_LZ_MAX) { keys[h] = key; vals[h] = (unsigned short)next_code; next_code++; }
      w = c;
    }
  }
  if (w >= 0) { o[no++] = (unsigned char)(w & 255); o[no++] = (unsigned char)((w >> 8) & 255); }
  free(keys); free(vals);
  *out = o;
  return no;
}

int evl_lz_decompress(const unsigned char *in, size_t n, EvlStr *out)
{
  unsigned short *prefix, *dlen;
  unsigned char *chr, *first, *tmp;
  unsigned long next_code = 256, k, i, ncodes, w, entry_first;
  int ok = 0;
  if (n == 0) return 0;
  if (n % 2 != 0) return -1;
  ncodes = (unsigned long)(n / 2);
  prefix = (unsigned short *)evl_alloc((EVL_LZ_MAX + 1) * sizeof(unsigned short));
  dlen = (unsigned short *)evl_alloc((EVL_LZ_MAX + 1) * sizeof(unsigned short));
  chr = (unsigned char *)evl_alloc(EVL_LZ_MAX + 1);
  first = (unsigned char *)evl_alloc(EVL_LZ_MAX + 1);
  tmp = (unsigned char *)evl_alloc(EVL_LZ_MAX + 2);
  for (i = 0; i < 256; i++) { prefix[i] = 0; dlen[i] = 1; chr[i] = (unsigned char)i; first[i] = (unsigned char)i; }

#define EVL_EMIT(code) do { \
    unsigned long cc_ = (code); unsigned long l_ = dlen[cc_]; unsigned long j_ = l_; \
    while (j_ > 0) { tmp[--j_] = chr[cc_]; cc_ = prefix[cc_]; } \
    evl_str_addn(out, (const char *)tmp, (size_t)l_); } while (0)

  w = (unsigned long)in[0] | ((unsigned long)in[1] << 8);
  if (w > 255) goto done;
  EVL_EMIT(w);
  for (i = 1; i < ncodes; i++) {
    k = (unsigned long)in[2 * i] | ((unsigned long)in[2 * i + 1] << 8);
    if (k < next_code) {
      EVL_EMIT(k);
      entry_first = first[k];
    } else if (k == next_code && next_code < EVL_LZ_MAX) {
      entry_first = first[w];
      EVL_EMIT(w);
      evl_str_addc(out, (int)entry_first);
    } else goto done;
    if (next_code < EVL_LZ_MAX) {
      prefix[next_code] = (unsigned short)w;
      chr[next_code] = (unsigned char)entry_first;
      first[next_code] = first[w];
      dlen[next_code] = (unsigned short)(dlen[w] + 1);
      next_code++;
    }
    w = k;
  }
  ok = 1;
done:
  free(prefix); free(dlen); free(chr); free(first); free(tmp);
  return ok ? 0 : -1;
#undef EVL_EMIT
}

static const char EVL_B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

void evl_b64_encode(const unsigned char *in, size_t n, EvlStr *out)
{
  size_t i;
  for (i = 0; i < n; i += 3) {
    unsigned long b0 = in[i];
    unsigned long b1 = i + 1 < n ? in[i + 1] : 0;
    unsigned long b2 = i + 2 < n ? in[i + 2] : 0;
    unsigned long trip = (b0 << 16) | (b1 << 8) | b2;
    evl_str_addc(out, EVL_B64[(trip >> 18) & 63]);
    evl_str_addc(out, EVL_B64[(trip >> 12) & 63]);
    evl_str_addc(out, i + 1 < n ? EVL_B64[(trip >> 6) & 63] : '=');
    evl_str_addc(out, i + 2 < n ? EVL_B64[trip & 63] : '=');
  }
}

static int evl_b64_val(int c)
{
  const char *p;
  if (c == 0) return 0;
  p = strchr(EVL_B64, c);
  return p ? (int)(p - EVL_B64) : 0;
}

size_t evl_b64_decode(const char *in, unsigned char **out)
{
  size_t len = strlen(in), i, no = 0;
  unsigned char *o;
  while (len > 0 && in[len - 1] == '=') len--;
  o = (unsigned char *)evl_alloc(len + 4);
  for (i = 0; i < len; i += 4) {
    unsigned long c0 = (unsigned long)evl_b64_val(in[i]);
    unsigned long c1 = (unsigned long)evl_b64_val(in[i + 1]);
    unsigned long c2 = i + 2 < len ? (unsigned long)evl_b64_val(in[i + 2]) : 0;
    unsigned long c3 = i + 3 < len ? (unsigned long)evl_b64_val(in[i + 3]) : 0;
    unsigned long trip = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    o[no++] = (unsigned char)((trip >> 16) & 255);
    if (i + 2 < len) o[no++] = (unsigned char)((trip >> 8) & 255);
    if (i + 3 < len) o[no++] = (unsigned char)(trip & 255);
  }
  *out = o;
  return no;
}

/* ======================================================================
   library
   ====================================================================== */
void evl_lib_init(EvlLib *lib) { lib->rec = NULL; lib->n = 0; lib->cap = 0; }

void evl_lib_clear(EvlLib *lib)
{
  int i;
  for (i = 0; i < lib->n; i++) {
    free(lib->rec[i].topic); free(lib->rec[i].topic_lc); free(lib->rec[i].cat);
    free(lib->rec[i].zfact); free(lib->rec[i].zex);
    evl_list_free(&lib->rec[i].words);
  }
  lib->n = 0;
}
void evl_lib_free(EvlLib *lib) { evl_lib_clear(lib); free(lib->rec); lib->rec = NULL; lib->cap = 0; }

static char *evl_pack(const char *clean)
{
  unsigned char *z;
  size_t zn;
  EvlStr b;
  char *r;
  if (!clean[0]) return evl_strdup("");
  zn = evl_lz_compress(clean, &z);
  evl_str_init(&b);
  evl_b64_encode(z, zn, &b);
  free(z);
  r = evl_strdup(b.s);
  evl_str_free(&b);
  return r;
}

static void evl_index_words(EvlRecord *r, const char *topic, const char *fact)
{
  EvlStr both;
  EvlList all;
  int i;
  evl_str_init(&both);
  evl_str_add(&both, topic);
  evl_str_addc(&both, ' ');
  evl_str_add(&both, fact);
  evl_list_init(&all);
  evl_tokenize_words(both.s, &all);
  evl_list_init(&r->words);
  for (i = 0; i < all.n; i++) if (!evl_list_has(&r->words, all.v[i])) evl_list_add(&r->words, all.v[i]);
  evl_list_free(&all);
  evl_str_free(&both);
}

static EvlRecord *evl_lib_push(EvlLib *lib)
{
  if (lib->n == lib->cap) {
    lib->cap = lib->cap ? lib->cap * 2 : 32;
    lib->rec = (EvlRecord *)evl_grow(lib->rec, (size_t)lib->cap * sizeof(EvlRecord));
  }
  return &lib->rec[lib->n++];
}

int evl_lib_add(EvlLib *lib, const char *topic, const char *cat, const char *fact, const char *ex)
{
  EvlStr ct, cc, cf, ce;
  EvlRecord *r;
  size_t k;
  evl_str_init(&ct); evl_str_init(&cc); evl_str_init(&cf); evl_str_init(&ce);
  evl_clean_ascii(topic ? topic : "", &ct);
  evl_clean_ascii((cat && cat[0]) ? cat : "general", &cc);
  evl_clean_ascii(fact ? fact : "", &cf);
  evl_clean_ascii(ex ? ex : "", &ce);
  r = evl_lib_push(lib);
  r->topic = evl_strdup(ct.s);
  r->topic_lc = evl_strdup(ct.s);
  for (k = 0; r->topic_lc[k]; k++) r->topic_lc[k] = (char)tolower((unsigned char)r->topic_lc[k]);
  r->cat = evl_strdup(cc.s);
  r->zfact = evl_pack(cf.s);
  r->zex = evl_pack(ce.s);
  evl_index_words(r, ct.s, cf.s);
  evl_str_free(&ct); evl_str_free(&cc); evl_str_free(&cf); evl_str_free(&ce);
  return lib->n - 1;
}

void evl_lib_starter(EvlLib *lib)
{
  int i;
  for (i = 0; i < EVL_STARTER_N; i++) evl_lib_add(lib, EVL_STARTER[i][0], EVL_STARTER[i][1], EVL_STARTER[i][2], EVL_STARTER[i][3]);
}

static void evl_trim_spaces(EvlStr *s)
{
  size_t a = 0, b = s->n;
  while (a < b && s->s[a] == ' ') a++;
  while (b > a && s->s[b - 1] == ' ') b--;
  memmove(s->s, s->s + a, b - a);
  s->n = b - a;
  s->s[s->n] = '\0';
}

static int evl_ingest_paragraph(EvlLib *lib, const char *para, size_t plen, const char *label)
{
  EvlStr p;
  size_t i, off;
  int count = 0, words = 0;
  EvlStr topic;
  evl_str_init(&p);
  for (i = 0; i < plen; ) {
    if (para[i] == '\n') {
      while (i < plen && para[i] == '\n') i++;
      evl_str_addc(&p, ' ');
    } else { evl_str_addc(&p, para[i]); i++; }
  }
  evl_trim_spaces(&p);
  if (p.n < 25) { evl_str_free(&p); return 0; }
  evl_str_init(&topic);
  i = 0;
  while (i < p.n && words < 3) {
    size_t s;
    while (i < p.n && p.s[i] == ' ') i++;
    s = i;
    while (i < p.n && p.s[i] != ' ') i++;
    if (i > s) {
      if (words) evl_str_addc(&topic, ' ');
      evl_str_addn(&topic, p.s + s, i - s);
      words++;
    }
  }
  for (off = 0; off < p.n; off += 140) {
    EvlStr chunk;
    size_t end = off + 170 > p.n ? p.n : off + 170;
    evl_str_init(&chunk);
    evl_str_addn(&chunk, p.s + off, end - off);
    evl_trim_spaces(&chunk);
    if (chunk.n >= 20) { evl_lib_add(lib, topic.s, label, chunk.s, ""); count++; }
    evl_str_free(&chunk);
  }
  evl_str_free(&topic);
  evl_str_free(&p);
  return count;
}

int evl_lib_ingest(EvlLib *lib, const char *raw, const char *label)
{
  EvlStr txt;
  size_t i = 0, start = 0, n;
  int count = 0;
  evl_str_init(&txt);
  evl_clean_ascii(raw, &txt);
  n = txt.n;
  while (i < n) {
    if (txt.s[i] == '\n') {
      size_t j = i, last = i;
      int found = 0;
      while (j < n && (txt.s[j] == ' ' || txt.s[j] == '\n')) { if (txt.s[j] == '\n') { last = j; found = (last > i); } j++; }
      if (found) {
        count += evl_ingest_paragraph(lib, txt.s + start, i - start, label && label[0] ? label : "imported");
        start = last + 1;
        i = start;
        continue;
      }
      i = j;
    } else i++;
  }
  count += evl_ingest_paragraph(lib, txt.s + start, n - start, label && label[0] ? label : "imported");
  evl_str_free(&txt);
  return count;
}

int evl_lib_search(const EvlLib *lib, const char *query, int topk, int *ids)
{
  EvlList q;
  int *score = (int *)evl_alloc((size_t)(lib->n ? lib->n : 1) * sizeof(int));
  int *taken = (int *)evl_alloc((size_t)(lib->n ? lib->n : 1) * sizeof(int));
  int i, j, found = 0, k;
  if (topk < 1) topk = 2;
  evl_list_init(&q);
  evl_tokenize_words(query, &q);
  for (i = 0; i < lib->n; i++) { score[i] = 0; taken[i] = 0; }
  for (j = 0; j < q.n; j++) {
    for (i = 0; i < lib->n; i++) {
      if (evl_list_has(&lib->rec[i].words, q.v[j])) score[i] += strstr(lib->rec[i].topic_lc, q.v[j]) ? 3 : 1;
    }
  }
  for (k = 0; k < topk; k++) {
    int best = -1;
    for (i = 0; i < lib->n; i++) {
      if (score[i] > 0 && !taken[i] && (best < 0 || score[i] > score[best])) best = i;
    }
    if (best < 0) break;
    taken[best] = 1;
    ids[found++] = best;
  }
  evl_list_free(&q);
  free(score); free(taken);
  return found;
}

void evl_lib_read(const EvlLib *lib, int id, EvlStr *fact, EvlStr *ex)
{
  unsigned char *z;
  size_t zn;
  const EvlRecord *r = &lib->rec[id];
  evl_str_clear(fact);
  evl_str_clear(ex);
  zn = evl_b64_decode(r->zfact, &z);
  evl_lz_decompress(z, zn, fact);
  free(z);
  if (r->zex[0]) {
    zn = evl_b64_decode(r->zex, &z);
    evl_lz_decompress(z, zn, ex);
    free(z);
  }
}

void evl_lib_stats(const EvlLib *lib, long *entries, long *chars)
{
  int i;
  *entries = lib->n;
  *chars = 0;
  for (i = 0; i < lib->n; i++) *chars += (long)(strlen(lib->rec[i].zfact) + strlen(lib->rec[i].zex));
}

void evl_lib_to_text(const EvlLib *lib, EvlStr *out)
{
  int i;
  for (i = 0; i < lib->n; i++) {
    evl_str_add(out, lib->rec[i].topic); evl_str_addc(out, '\t');
    evl_str_add(out, lib->rec[i].cat); evl_str_addc(out, '\t');
    evl_str_add(out, lib->rec[i].zfact); evl_str_addc(out, '\t');
    evl_str_add(out, lib->rec[i].zex); evl_str_addc(out, '\n');
  }
}

int evl_lib_from_text(EvlLib *lib, const char *text)
{
  const char *p = text;
  int count = 0;
  evl_lib_clear(lib);
  while (*p) {
    const char *eol = strchr(p, '\n'), *f[4];
    size_t llen, nf = 0, i;
    char *line;
    if (!eol) eol = p + strlen(p);
    llen = (size_t)(eol - p);
    if (llen > 0 && p[llen - 1] == '\r') llen--;
    if (llen > 0) {
      line = evl_strndup(p, llen);
      f[0] = line; nf = 1;
      for (i = 0; i < llen; i++) {
        if (line[i] == '\t') { line[i] = '\0'; if (nf < 4) f[nf++] = line + i + 1; }
      }
      if (nf >= 3) {
        EvlRecord *r = evl_lib_push(lib);
        EvlStr fact, ex;
        unsigned char *z;
        size_t zn, k;
        r->topic = evl_strdup(f[0]);
        r->topic_lc = evl_strdup(f[0]);
        for (k = 0; r->topic_lc[k]; k++) r->topic_lc[k] = (char)tolower((unsigned char)r->topic_lc[k]);
        r->cat = evl_strdup(f[1]);
        r->zfact = evl_strdup(f[2]);
        r->zex = evl_strdup(nf > 3 ? f[3] : "");
        evl_str_init(&fact); evl_str_init(&ex);
        zn = evl_b64_decode(r->zfact, &z);
        evl_lz_decompress(z, zn, &fact);
        free(z);
        evl_index_words(r, r->topic, fact.s);
        evl_str_free(&fact); evl_str_free(&ex);
        count++;
      }
      free(line);
    }
    p = *eol ? eol + 1 : eol;
  }
  return count;
}

/* ======================================================================
   TNY2 model
   ====================================================================== */
long evl_tny2_size(int D, int L, int HID)
{
  return 12L + (long)(EVL_VOCAB + EVL_CTX) * (4L + D) +
    (long)L * (4L * D + 4L * D * (4L + D) + 4L * D + (long)HID * (4L + D) + (long)D * (4L + HID)) + 4L * D;
}

void evl_model_init(EvlModel *m)
{
  memset(m, 0, sizeof(*m));
  evl_rng_seed(&m->rng, 0);
}

static void evl_table_free(EvlTable *t) { free(t->scale); free(t->w); t->scale = NULL; t->w = NULL; }

void evl_model_free(EvlModel *m)
{
  int l;
  if (m->loaded) {
    evl_table_free(&m->emb); evl_table_free(&m->pos);
    for (l = 0; l < m->L; l++) {
      evl_table_free(&m->wq[l]); evl_table_free(&m->wk[l]); evl_table_free(&m->wv[l]);
      evl_table_free(&m->wo[l]); evl_table_free(&m->f1[l]); evl_table_free(&m->f2[l]);
      free(m->g1[l]); free(m->g2[l]); free(m->kc[l]); free(m->vc[l]); free(m->ks[l]); free(m->vs[l]);
    }
    free(m->gf); free(m->bx); free(m->bh); free(m->bq); free(m->bt); free(m->ba); free(m->bm); free(m->bs);
  }
  m->loaded = 0;
}

static float evl_rd_f32(const unsigned char *p)
{
  evl_u32 u = (evl_u32)p[0] | ((evl_u32)p[1] << 8) | ((evl_u32)p[2] << 16) | ((evl_u32)p[3] << 24);
  float f;
  memcpy(&f, &u, 4);
  return f;
}

static const unsigned char *evl_rd_table(const unsigned char *p, EvlTable *t, int rows, int cols)
{
  int r;
  t->rows = rows; t->cols = cols;
  t->scale = (float *)evl_alloc((size_t)rows * sizeof(float));
  t->w = (signed char *)evl_alloc((size_t)rows * (size_t)cols);
  for (r = 0; r < rows; r++) {
    t->scale[r] = evl_rd_f32(p); p += 4;
    memcpy(t->w + (size_t)r * (size_t)cols, p, (size_t)cols);
    p += cols;
  }
  return p;
}

static const unsigned char *evl_rd_gains(const unsigned char *p, float **g, int n)
{
  int i;
  *g = (float *)evl_alloc((size_t)n * sizeof(float));
  for (i = 0; i < n; i++) { (*g)[i] = evl_rd_f32(p); p += 4; }
  return p;
}

int evl_model_load(EvlModel *m, const unsigned char *buf, size_t n)
{
  int D, L, H, HID, l;
  const unsigned char *p;
  if (n < 12 || memcmp(buf, "TNY2", 4) != 0) return 1;
  D = buf[4] | (buf[5] << 8); L = buf[6] | (buf[7] << 8);
  H = buf[8] | (buf[9] << 8); HID = buf[10] | (buf[11] << 8);
  if (D < 1 || D > 512 || L < 1 || L > EVL_MAXL || H < 1 || D % H != 0 || HID < 1 || HID > 2048) return 2;
  if ((long)n < evl_tny2_size(D, L, HID)) return 3;
  evl_model_free(m);
  m->D = D; m->L = L; m->H = H; m->HID = HID; m->HD = D / H;
  m->att_div = sqrt((double)m->HD);
  p = buf + 12;
  p = evl_rd_table(p, &m->emb, EVL_VOCAB, D);
  p = evl_rd_table(p, &m->pos, EVL_CTX, D);
  for (l = 0; l < L; l++) {
    p = evl_rd_gains(p, &m->g1[l], D);
    p = evl_rd_table(p, &m->wq[l], D, D);
    p = evl_rd_table(p, &m->wk[l], D, D);
    p = evl_rd_table(p, &m->wv[l], D, D);
    p = evl_rd_table(p, &m->wo[l], D, D);
    p = evl_rd_gains(p, &m->g2[l], D);
    p = evl_rd_table(p, &m->f1[l], HID, D);
    p = evl_rd_table(p, &m->f2[l], D, HID);
    m->kc[l] = (signed char *)evl_alloc((size_t)EVL_CTX * (size_t)D);
    m->vc[l] = (signed char *)evl_alloc((size_t)EVL_CTX * (size_t)D);
    memset(m->kc[l], 0, (size_t)EVL_CTX * (size_t)D);
    memset(m->vc[l], 0, (size_t)EVL_CTX * (size_t)D);
    m->ks[l] = (float *)evl_alloc(EVL_CTX * sizeof(float));
    m->vs[l] = (float *)evl_alloc(EVL_CTX * sizeof(float));
    memset(m->ks[l], 0, EVL_CTX * sizeof(float));
    memset(m->vs[l], 0, EVL_CTX * sizeof(float));
  }
  p = evl_rd_gains(p, &m->gf, D);
  m->bx = (float *)evl_alloc((size_t)D * sizeof(float));
  m->bh = (float *)evl_alloc((size_t)D * sizeof(float));
  m->bq = (float *)evl_alloc((size_t)D * sizeof(float));
  m->bt = (float *)evl_alloc((size_t)D * sizeof(float));
  m->ba = (float *)evl_alloc((size_t)D * sizeof(float));
  m->bm = (float *)evl_alloc((size_t)HID * sizeof(float));
  m->bs = (float *)evl_alloc(EVL_CTX * sizeof(float));
  m->kv_prefix = 0;
  m->loaded = 1;
  return 0;
}

static void evl_matvec(const EvlTable *t, const float *x, float *y)
{
  int r, c, rows = t->rows, cols = t->cols;
  for (r = 0; r < rows; r++) {
    double s = 0.0;
    const signed char *w = t->w + (size_t)r * (size_t)cols;
    for (c = 0; c < cols; c++) s += (double)w[c] * (double)x[c];
    y[r] = (float)(s * (double)t->scale[r]);
  }
}

static void evl_norm(const EvlModel *m, const float *x, const float *g, float *y)
{
  int i, D = m->D;
  double s = 0.0, inv;
  for (i = 0; i < D; i++) s += (double)x[i] * (double)x[i];
  inv = 1.0 / sqrt(s / D + 1e-5);
  for (i = 0; i < D; i++) y[i] = (float)((double)x[i] * inv * (double)g[i]);
}

static float evl_store(int D, signed char *dst, const float *src)
{
  int i;
  double big = 0.0, k, v;
  for (i = 0; i < D; i++) {
    v = src[i] < 0 ? -(double)src[i] : (double)src[i];
    if (v > big) big = v;
  }
  if (big < 1e-20) big = 1e-20;
  k = 127.0 / big;
  for (i = 0; i < D; i++) {
    v = (double)src[i] * k;
    dst[i] = (signed char)(v < 0 ? ceil(v - 0.5) : floor(v + 0.5));
  }
  return (float)(big / 127.0);
}

void evl_model_step(EvlModel *m, int tok, int p)
{
  int D = m->D, L = m->L, H = m->H, HD = m->HD, HID = m->HID, i, j, l, h;
  double es, ps;
  if (!m->loaded || tok < 0 || tok >= EVL_VOCAB || p < 0 || p >= EVL_CTX) return;
  es = (double)m->emb.scale[tok];
  ps = (double)m->pos.scale[p];
  for (i = 0; i < D; i++) {
    m->bx[i] = (float)((double)m->emb.w[(size_t)tok * (size_t)D + i] * es + (double)m->pos.w[(size_t)p * (size_t)D + i] * ps);
  }
  for (l = 0; l < L; l++) {
    signed char *kcl = m->kc[l], *vcl = m->vc[l];
    float *ksl = m->ks[l], *vsl = m->vs[l];
    evl_norm(m, m->bx, m->g1[l], m->bh);
    evl_matvec(&m->wk[l], m->bh, m->bt);
    ksl[p] = evl_store(D, kcl + (size_t)p * (size_t)D, m->bt);
    evl_matvec(&m->wv[l], m->bh, m->bt);
    vsl[p] = evl_store(D, vcl + (size_t)p * (size_t)D, m->bt);
    evl_matvec(&m->wq[l], m->bh, m->bq);
    for (h = 0; h < H; h++) {
      int hOff = h * HD;
      double big = -1e30, sum = 0.0;
      for (j = 0; j <= p; j++) {
        size_t kp = (size_t)j * (size_t)D + (size_t)hOff;
        double s = 0.0;
        for (i = 0; i < HD; i++) s += (double)m->bq[hOff + i] * (double)kcl[kp + i];
        s = (s * (double)ksl[j]) / m->att_div;
        m->bs[j] = (float)s;
        if (s > big) big = s;
      }
      for (j = 0; j <= p; j++) {
        double diff = (double)m->bs[j] - big;
        m->bs[j] = (float)(diff < -60.0 ? 0.0 : exp(diff));
        sum += (double)m->bs[j];
      }
      for (i = 0; i < HD; i++) m->ba[hOff + i] = 0.0f;
      for (j = 0; j <= p; j++) {
        size_t vp;
        double wgt;
        if (m->bs[j] == 0.0f) continue;
        vp = (size_t)j * (size_t)D + (size_t)hOff;
        wgt = ((double)m->bs[j] * (double)vsl[j]) / sum;
        for (i = 0; i < HD; i++) m->ba[hOff + i] = (float)((double)m->ba[hOff + i] + wgt * (double)vcl[vp + i]);
      }
    }
    evl_matvec(&m->wo[l], m->ba, m->bt);
    for (i = 0; i < D; i++) m->bx[i] = (float)((double)m->bx[i] + (double)m->bt[i]);
    evl_norm(m, m->bx, m->g2[l], m->bh);
    evl_matvec(&m->f1[l], m->bh, m->bm);
    for (i = 0; i < HID; i++) if (m->bm[i] < 0) m->bm[i] = 0.0f;
    evl_matvec(&m->f2[l], m->bm, m->bt);
    for (i = 0; i < D; i++) m->bx[i] = (float)((double)m->bx[i] + (double)m->bt[i]);
  }
  evl_norm(m, m->bx, m->gf, m->bh);
  evl_matvec(&m->emb, m->bh, m->score);
}

int evl_model_pick(EvlModel *m, double creativity)
{
  int i, best = 0;
  double t, sum = 0.0, r;
  for (i = 1; i < EVL_VOCAB; i++) if (m->score[i] > m->score[best]) best = i;
  if (creativity <= 0) return best;
  t = creativity / 5.0;
  for (i = 0; i < EVL_VOCAB; i++) {
    double d = ((double)m->score[i] - (double)m->score[best]) / t;
    double ex = d < -60.0 ? 0.0 : exp(d);
    m->bs[i] = (float)(ex < 0.15 ? 0.0 : ex);
    sum += (double)m->bs[i];
  }
  r = sum * evl_rng_next(&m->rng);
  for (i = 0; i < EVL_VOCAB; i++) {
    r -= (double)m->bs[i];
    if (r < 0.0 && m->bs[i] > 0.0f) return i;
  }
  return best;
}

void evl_model_reset(EvlModel *m) { m->kv_prefix = 0; }

static void evl_clean_line(const char *text, EvlStr *out)
{
  size_t i;
  evl_clean_ascii(text, out);
  for (i = 0; i < out->n; i++) if (out->s[i] == '\n') out->s[i] = ' ';
}

int evl_model_prime(EvlModel *m, const char *text)
{
  EvlStr clean;
  int p = m->kv_prefix;
  size_t i;
  if (!m->loaded) return 0;
  evl_str_init(&clean);
  evl_clean_line(text, &clean);
  for (i = 0; i < clean.n && p < EVL_CTX - 2; i++, p++) evl_model_step(m, (unsigned char)clean.s[i] - 30, p);
  m->kv_prefix = p;
  evl_str_free(&clean);
  return p;
}

void evl_model_think(EvlModel *m, const char *question, double creativity, EvlStr *out)
{
  EvlStr clean;
  int p = m->kv_prefix, tok;
  size_t i;
  evl_str_clear(out);
  if (!m->loaded) return;
  evl_str_init(&clean);
  evl_clean_line(question, &clean);
  for (i = 0; i < clean.n && p < EVL_CTX - 2; i++, p++) evl_model_step(m, (unsigned char)clean.s[i] - 30, p);
  evl_model_step(m, 1, p++);
  for (; p < EVL_CTX; p++) {
    tok = evl_model_pick(m, creativity);
    if (tok <= 1) break;
    evl_str_addc(out, tok + 30);
    evl_model_step(m, tok, p);
  }
  evl_str_free(&clean);
}

static void evl_wr_u16(unsigned char *p, unsigned v) { p[0] = (unsigned char)(v & 255); p[1] = (unsigned char)((v >> 8) & 255); }
static void evl_wr_f32(unsigned char *p, float f)
{
  evl_u32 u;
  memcpy(&u, &f, 4);
  p[0] = (unsigned char)(u & 255); p[1] = (unsigned char)((u >> 8) & 255);
  p[2] = (unsigned char)((u >> 16) & 255); p[3] = (unsigned char)((u >> 24) & 255);
}

size_t evl_model_kv_export(const EvlModel *m, int seq_len, unsigned char **out)
{
  size_t size, off = 10;
  unsigned char *b;
  int l, t;
  if (seq_len < 0) seq_len = 0;
  if (seq_len > EVL_CTX) seq_len = EVL_CTX;
  size = 10 + (size_t)m->L * (size_t)seq_len * 2 * (4 + (size_t)m->D);
  b = (unsigned char *)evl_alloc(size);
  memcpy(b, "KV21", 4);
  evl_wr_u16(b + 4, (unsigned)m->D); evl_wr_u16(b + 6, (unsigned)m->L); evl_wr_u16(b + 8, (unsigned)seq_len);
  for (l = 0; l < m->L; l++) {
    for (t = 0; t < seq_len; t++) {
      evl_wr_f32(b + off, m->ks[l][t]); off += 4;
      memcpy(b + off, m->kc[l] + (size_t)t * (size_t)m->D, (size_t)m->D); off += (size_t)m->D;
      evl_wr_f32(b + off, m->vs[l][t]); off += 4;
      memcpy(b + off, m->vc[l] + (size_t)t * (size_t)m->D, (size_t)m->D); off += (size_t)m->D;
    }
  }
  *out = b;
  return size;
}

int evl_model_kv_import(EvlModel *m, const unsigned char *buf, size_t n)
{
  int d, l, len, layer, t;
  size_t off = 10;
  if (n < 10 || memcmp(buf, "KV21", 4) != 0) return -1;
  d = buf[4] | (buf[5] << 8); l = buf[6] | (buf[7] << 8); len = buf[8] | (buf[9] << 8);
  if (!m->loaded || d != m->D || l != m->L || len > EVL_CTX) return -1;
  if (n < 10 + (size_t)l * (size_t)len * 2 * (4 + (size_t)d)) return -1;
  for (layer = 0; layer < m->L; layer++) {
    for (t = 0; t < len; t++) {
      m->ks[layer][t] = evl_rd_f32(buf + off); off += 4;
      memcpy(m->kc[layer] + (size_t)t * (size_t)d, buf + off, (size_t)d); off += (size_t)d;
      m->vs[layer][t] = evl_rd_f32(buf + off); off += 4;
      memcpy(m->vc[layer] + (size_t)t * (size_t)d, buf + off, (size_t)d); off += (size_t)d;
    }
  }
  m->kv_prefix = len;
  return len;
}

/* ======================================================================
   profile
   ====================================================================== */
void evl_pm_init(EvlProfile *p)
{
  evl_list_init(&p->solved); evl_list_init(&p->inv); evl_list_init(&p->mastered); evl_list_init(&p->recent);
  evl_pm_reset(p);
}
void evl_pm_free(EvlProfile *p)
{
  evl_list_free(&p->solved); evl_list_free(&p->inv); evl_list_free(&p->mastered); evl_list_free(&p->recent);
}
void evl_pm_reset(EvlProfile *p)
{
  strcpy(p->name, "Explorer"); strcpy(p->pace, "normal"); strcpy(p->room, "camp");
  p->mode = 'M'; p->xp = 0;
  p->fb[0] = p->fb[1] = p->fb[2] = p->fb[3] = 0;
  evl_list_clear(&p->solved); evl_list_clear(&p->inv); evl_list_clear(&p->mastered); evl_list_clear(&p->recent);
}

static int evl_mode_index(char m) { return m == 'R' ? 0 : (m == 'A' ? 1 : (m == 'D' ? 2 : 3)); }

char evl_pm_set_mode(EvlProfile *p, const char *m)
{
  char c = (m && m[0]) ? (char)toupper((unsigned char)m[0]) : 'M';
  if (c == 'R' || c == 'A' || c == 'D' || c == 'M') p->mode = c;
  return p->mode;
}

void evl_pm_record(EvlProfile *p, const char *topic, long bonus_xp)
{
  p->xp += bonus_xp < 0 ? 10 : bonus_xp;
  p->fb[evl_mode_index(p->mode)] += 1;
  if (topic && topic[0] && !evl_list_has(&p->mastered, topic)) evl_list_add(&p->mastered, topic);
}

char evl_pm_best(const EvlProfile *p)
{
  static const char modes[4] = { 'R', 'A', 'D', 'M' };
  char best = p->mode;
  long bestScore = 0;
  int i;
  for (i = 0; i < 4; i++) if (p->fb[i] > bestScore) { bestScore = p->fb[i]; best = modes[i]; }
  return best;
}

static void evl_line_safe(EvlStr *out, const char *s)
{
  for (; *s; s++) evl_str_addc(out, (*s == '\r' || *s == '\n') ? ' ' : *s);
}

void evl_pm_to_cfg(const EvlProfile *p, EvlStr *out)
{
  evl_str_add(out, "NAME="); evl_line_safe(out, p->name); evl_str_addc(out, '\n');
  evl_str_add(out, "MODE="); evl_str_addc(out, p->mode); evl_str_addc(out, '\n');
  evl_str_add(out, "PACE="); evl_line_safe(out, p->pace); evl_str_addc(out, '\n');
  evl_str_add(out, "XP="); evl_str_addi(out, p->xp); evl_str_addc(out, '\n');
  evl_str_add(out, "FB="); evl_str_addi(out, p->fb[0]); evl_str_addc(out, ','); evl_str_addi(out, p->fb[1]);
  evl_str_addc(out, ','); evl_str_addi(out, p->fb[2]); evl_str_addc(out, ','); evl_str_addi(out, p->fb[3]); evl_str_addc(out, '\n');
  evl_str_add(out, "ROOM="); evl_str_add(out, p->room); evl_str_addc(out, '\n');
  evl_str_add(out, "SOLVED="); evl_list_join(&p->solved, out); evl_str_addc(out, '\n');
  evl_str_add(out, "INV="); evl_list_join(&p->inv, out); evl_str_addc(out, '\n');
  evl_str_add(out, "MASTERED="); evl_list_join(&p->mastered, out); evl_str_addc(out, '\n');
  evl_str_add(out, "RECENT="); evl_list_join(&p->recent, out); evl_str_addc(out, '\n');
}

static void evl_copy_cap(char *dst, size_t cap, const char *src)
{
  size_t n = strlen(src);
  if (n >= cap) n = cap - 1;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

void evl_pm_from_cfg(EvlProfile *p, const char *text)
{
  const char *s = text;
  evl_pm_reset(p);
  while (*s) {
    const char *eol = strchr(s, '\n'), *eq;
    size_t llen;
    char *line, *key, *val;
    if (!eol) eol = s + strlen(s);
    llen = (size_t)(eol - s);
    if (llen > 0 && s[llen - 1] == '\r') llen--;
    line = evl_strndup(s, llen);
    eq = strchr(line, '=');
    if (eq && eq > line) {
      key = line; *(char *)eq = '\0'; val = (char *)eq + 1;
      if (strcmp(key, "NAME") == 0) evl_copy_cap(p->name, sizeof(p->name), val[0] ? val : "Explorer");
      else if (strcmp(key, "MODE") == 0) { if (val[0] == 'R' || val[0] == 'A' || val[0] == 'D' || val[0] == 'M') p->mode = val[0]; }
      else if (strcmp(key, "PACE") == 0) evl_copy_cap(p->pace, sizeof(p->pace), val[0] ? val : "normal");
      else if (strcmp(key, "XP") == 0) p->xp = (long)floor(evl_val_of(val));
      else if (strcmp(key, "FB") == 0) {
        int k;
        const char *q = val;
        for (k = 0; k < 4; k++) {
          p->fb[k] = (long)floor(evl_val_of(q));
          q = strchr(q, ',');
          if (!q) { for (k++; k < 4; k++) p->fb[k] = 0; break; }
          q++;
        }
      }
      else if (strcmp(key, "ROOM") == 0) evl_copy_cap(p->room, sizeof(p->room), val[0] ? val : "camp");
      else if (strcmp(key, "SOLVED") == 0) evl_list_split(&p->solved, val);
      else if (strcmp(key, "INV") == 0) evl_list_split(&p->inv, val);
      else if (strcmp(key, "MASTERED") == 0) evl_list_split(&p->mastered, val);
      else if (strcmp(key, "RECENT") == 0) evl_list_split(&p->recent, val);
    }
    free(line);
    s = *eol ? eol + 1 : eol;
  }
}

/* ======================================================================
   audio
   ====================================================================== */
EvlStr evl_last_spoken = { NULL, 0, 0 };
void (*evl_tone_hook)(int freq, int ms) = NULL;

int evl_chirp_plan(const char *text, int *freqs)
{
  int n = (int)strlen(text), i;
  if (n > 14) n = 14;
  for (i = 0; i < n; i++) {
    int c = (unsigned char)text[i];
    freqs[i] = c == 32 ? 0 : 280 + (c % 24) * 35;
  }
  return n;
}

void evl_audio_speak(const char *text, char mode)
{
  int freqs[14], n, i;
  if (mode == 'R' || mode == 'D') return;
  if (!evl_last_spoken.s) evl_str_init(&evl_last_spoken);
  evl_str_clear(&evl_last_spoken);
  evl_str_add(&evl_last_spoken, text);
  if (evl_tone_hook) {
    n = evl_chirp_plan(text, freqs);
    for (i = 0; i < n; i++) evl_tone_hook(freqs[i], 42);
  }
}

/* ======================================================================
   coding sandbox
   ====================================================================== */
void evl_vars_init(EvlVars *v) { v->v = NULL; v->n = 0; v->cap = 0; }
void evl_val_free(EvlVal *v) { free(v->str); v->str = NULL; v->is_str = 0; v->num = 0; }
void evl_vars_free(EvlVars *v)
{
  int i;
  for (i = 0; i < v->n; i++) { free(v->v[i].name); evl_val_free(&v->v[i].val); }
  free(v->v);
  v->v = NULL; v->n = v->cap = 0;
}

static void evl_val_copy(EvlVal *dst, const EvlVal *src)
{
  dst->is_str = src->is_str; dst->num = src->num;
  dst->str = src->is_str ? evl_strdup(src->str ? src->str : "") : NULL;
}
static void evl_val_set_num(EvlVal *v, double x) { v->is_str = 0; v->num = x; v->str = NULL; }
static void evl_val_set_str(EvlVal *v, const char *s) { v->is_str = 1; v->num = 0; v->str = evl_strdup(s); }
static double evl_val_to_num(const EvlVal *v) { return v->is_str ? evl_val_of(v->str) : v->num; }
void evl_val_text(const EvlVal *v, EvlStr *out)
{
  char tmp[48];
  if (v->is_str) evl_str_add(out, v->str);
  else { evl_fmt_num(v->num, tmp); evl_str_add(out, tmp); }
}
static int evl_val_true(const EvlVal *v) { return v->is_str ? v->str[0] != '\0' : v->num != 0.0; }

static EvlVar *evl_vars_find(EvlVars *v, const char *name)
{
  int i;
  if (!v) return NULL;
  for (i = 0; i < v->n; i++) if (strcmp(v->v[i].name, name) == 0) return &v->v[i];
  return NULL;
}

static void evl_vars_set(EvlVars *v, const char *name, const EvlVal *val)
{
  EvlVar *e = evl_vars_find(v, name);
  if (e) { evl_val_free(&e->val); evl_val_copy(&e->val, val); return; }
  if (v->n == v->cap) {
    v->cap = v->cap ? v->cap * 2 : 8;
    v->v = (EvlVar *)evl_grow(v->v, (size_t)v->cap * sizeof(EvlVar));
  }
  v->v[v->n].name = evl_strdup(name);
  evl_val_copy(&v->v[v->n].val, val);
  v->n++;
}

static void evl_upper(char *s) { for (; *s; s++) *s = (char)toupper((unsigned char)*s); }

/* expression tokens: "text", names, numbers, <= >= == != and one-character operators; anything else is skipped */
static void evl_tokenize_expr(const char *s, EvlList *toks)
{
  size_t i = 0, j;
  while (s[i]) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"') {
      j = i + 1;
      while (s[j] && s[j] != '"') j++;
      if (s[j] == '"') {
        char *t = evl_strndup(s + i, j - i + 1);
        evl_list_add(toks, t); free(t);
        i = j + 1;
      } else i++;
    } else if (isalpha(c) || c == '_') {
      char *t;
      j = i;
      while (isalnum((unsigned char)s[j]) || s[j] == '_') j++;
      t = evl_strndup(s + i, j - i);
      evl_list_add(toks, t); free(t);
      i = j;
    } else if (isdigit(c)) {
      char *t;
      j = i;
      while (isdigit((unsigned char)s[j])) j++;
      if (s[j] == '.' && isdigit((unsigned char)s[j + 1])) { j++; while (isdigit((unsigned char)s[j])) j++; }
      t = evl_strndup(s + i, j - i);
      evl_list_add(toks, t); free(t);
      i = j;
    } else if ((c == '<' || c == '>' || c == '=' || c == '!') && s[i + 1] == '=') {
      char t[3];
      t[0] = (char)c; t[1] = '='; t[2] = '\0';
      evl_list_add(toks, t);
      i += 2;
    } else if (strchr("+-*/%()<>=", c) && c != 0) {
      char t[2];
      t[0] = (char)c; t[1] = '\0';
      evl_list_add(toks, t);
      i++;
    } else i++;
  }
}

typedef struct { EvlList toks; int pos; EvlVars *vars; } EvlParser;

static const char *evl_peek(EvlParser *p) { return p->pos < p->toks.n ? p->toks.v[p->pos] : NULL; }
static const char *evl_next(EvlParser *p) { return p->pos < p->toks.n ? p->toks.v[p->pos++] : NULL; }

static void evl_parse_comparison(EvlParser *p, EvlVal *out);

static void evl_parse_factor(EvlParser *p, EvlVal *out)
{
  const char *t = evl_next(p);
  if (!t) { evl_val_set_num(out, 0); return; }
  if (strcmp(t, "(") == 0) {
    evl_parse_comparison(p, out);
    if (evl_peek(p) && strcmp(evl_peek(p), ")") == 0) evl_next(p);
    return;
  }
  if (strcmp(t, "-") == 0) {
    EvlVal v;
    evl_parse_factor(p, &v);
    evl_val_set_num(out, -evl_val_to_num(&v));
    evl_val_free(&v);
    return;
  }
  if (t[0] == '"') {
    char *inner = evl_strndup(t + 1, strlen(t) - 2);
    evl_val_set_str(out, inner);
    free(inner);
    return;
  }
  if (isdigit((unsigned char)t[0])) { evl_val_set_num(out, evl_parse_decimal(t, NULL)); return; }
  {
    char *key = evl_strdup(t);
    EvlVar *e;
    evl_upper(key);
    e = evl_vars_find(p->vars, key);
    if (e) evl_val_copy(out, &e->val); else evl_val_set_num(out, 0);
    free(key);
  }
}

static void evl_parse_mul(EvlParser *p, EvlVal *out)
{
  evl_parse_factor(p, out);
  while (evl_peek(p) && (strcmp(evl_peek(p), "*") == 0 || strcmp(evl_peek(p), "/") == 0 || strcmp(evl_peek(p), "%") == 0)) {
    char op = evl_next(p)[0];
    EvlVal rv;
    double r, l;
    evl_parse_factor(p, &rv);
    r = evl_val_to_num(&rv);
    l = evl_val_to_num(out);
    evl_val_free(&rv);
    evl_val_free(out);
    if (op == '*') evl_val_set_num(out, l * r);
    else if (op == '/') evl_val_set_num(out, r == 0 ? 0 : l / r);
    else evl_val_set_num(out, r == 0 ? 0 : fmod(l, r));
  }
}

static void evl_parse_add(EvlParser *p, EvlVal *out)
{
  evl_parse_mul(p, out);
  while (evl_peek(p) && (strcmp(evl_peek(p), "+") == 0 || strcmp(evl_peek(p), "-") == 0)) {
    char op = evl_next(p)[0];
    EvlVal rv;
    evl_parse_mul(p, &rv);
    if (op == '+') {
      if (out->is_str || rv.is_str) {
        EvlStr s;
        evl_str_init(&s);
        evl_val_text(out, &s);
        evl_val_text(&rv, &s);
        evl_val_free(out);
        evl_val_set_str(out, s.s);
        evl_str_free(&s);
      } else out->num = out->num + rv.num;
    } else {
      double d = evl_val_to_num(out) - evl_val_to_num(&rv);
      evl_val_free(out);
      evl_val_set_num(out, d);
    }
    evl_val_free(&rv);
  }
}

static void evl_parse_comparison(EvlParser *p, EvlVal *out)
{
  const char *op;
  evl_parse_add(p, out);
  op = evl_peek(p);
  if (op && (strcmp(op, "<") == 0 || strcmp(op, ">") == 0 || strcmp(op, "<=") == 0 || strcmp(op, ">=") == 0 ||
             strcmp(op, "==") == 0 || strcmp(op, "!=") == 0 || strcmp(op, "=") == 0)) {
    EvlVal rv;
    int c, r;
    char o[3];
    strcpy(o, op);
    evl_next(p);
    evl_parse_add(p, &rv);
    if (out->is_str && rv.is_str) { int sc = strcmp(out->str, rv.str); c = sc < 0 ? -1 : (sc > 0 ? 1 : 0); }
    else { double a = evl_val_to_num(out), b = evl_val_to_num(&rv); c = a < b ? -1 : (a > b ? 1 : 0); }
    if (strcmp(o, "<") == 0) r = c < 0;
    else if (strcmp(o, ">") == 0) r = c > 0;
    else if (strcmp(o, "<=") == 0) r = c <= 0;
    else if (strcmp(o, ">=") == 0) r = c >= 0;
    else if (strcmp(o, "!=") == 0) r = c != 0;
    else r = c == 0;
    evl_val_free(out);
    evl_val_free(&rv);
    evl_val_set_num(out, r ? 1 : 0);
  }
}

void evl_eval_expr(const char *expr, EvlVars *vars, EvlVal *out)
{
  EvlParser p;
  evl_list_init(&p.toks);
  evl_tokenize_expr(expr, &p.toks);
  p.pos = 0; p.vars = vars;
  evl_parse_comparison(&p, out);
  evl_list_free(&p.toks);
}

void evl_run_init(EvlRun *r)
{
  r->ok = 0;
  evl_str_init(&r->error); evl_list_init(&r->output); evl_str_init(&r->grid); evl_vars_init(&r->vars);
}
void evl_run_free(EvlRun *r)
{
  evl_str_free(&r->error); evl_list_free(&r->output); evl_str_free(&r->grid); evl_vars_free(&r->vars);
}

static void evl_render_grid(char grid[12][12], int tx, int ty, EvlStr *out)
{
  int r, c;
  evl_str_clear(out);
  for (r = 0; r < 12; r++) {
    if (r) evl_str_addc(out, '\n');
    for (c = 0; c < 12; c++) {
      if (c) evl_str_addc(out, ' ');
      evl_str_addc(out, (r == ty && c == tx) ? '@' : grid[r][c]);
    }
  }
}

static void evl_trim_copy(const char *s, size_t n, EvlStr *out)
{
  size_t a = 0, b = n;
  while (a < b && isspace((unsigned char)s[a])) a++;
  while (b > a && isspace((unsigned char)s[b - 1])) b--;
  evl_str_clear(out);
  evl_str_addn(out, s + a, b - a);
}

static void evl_line_error(EvlRun *r, int line, const char *msg, const char *quote, const char *tail)
{
  r->ok = 0;
  evl_str_clear(&r->error);
  evl_str_add(&r->error, "Line "); evl_str_addi(&r->error, line); evl_str_add(&r->error, ": ");
  evl_str_add(&r->error, msg);
  if (quote) { evl_str_add(&r->error, quote); }
  if (tail) evl_str_add(&r->error, tail);
}

void evl_run_code(const char *source, EvlRun *res)
{
  char grid[12][12];
  int tx = 4, ty = 4, dir = 0, rr, cc, nlines = 0, i, pc, steps = 0;
  static const int dx[4] = { 1, 0, -1, 0 }, dy[4] = { 0, 1, 0, -1 };
  char **lines;
  const char *s;
  int *jumps, *stack, sp = 0;
  double *counters;
  EvlStr raw, upper, tmp;

  for (rr = 0; rr < 12; rr++) for (cc = 0; cc < 12; cc++) grid[rr][cc] = '.';
  grid[ty][tx] = '#';
  evl_run_free(res); evl_run_init(res);

  /* split into lines (a final newline gives a final empty line, as in JavaScript) */
  nlines = 1;
  for (s = source; *s; s++) if (*s == '\n') nlines++;
  lines = (char **)evl_alloc((size_t)nlines * sizeof(char *));
  {
    const char *p = source;
    for (i = 0; i < nlines; i++) {
      const char *eol = strchr(p, '\n');
      size_t len = eol ? (size_t)(eol - p) : strlen(p);
      size_t keep = (len > 0 && p[len - 1] == '\r') ? len - 1 : len;
      lines[i] = evl_strndup(p, keep);
      p = eol ? eol + 1 : p + len;
    }
  }
  jumps = (int *)evl_alloc((size_t)nlines * sizeof(int));
  stack = (int *)evl_alloc((size_t)nlines * sizeof(int));
  counters = (double *)evl_alloc((size_t)nlines * sizeof(double));
  for (i = 0; i < nlines; i++) { jumps[i] = -1; counters[i] = 0; }
  evl_str_init(&raw); evl_str_init(&upper); evl_str_init(&tmp);

  for (i = 0; i < nlines; i++) {
    evl_trim_copy(lines[i], strlen(lines[i]), &tmp);
    evl_upper(tmp.s);
    if (strncmp(tmp.s, "REPEAT ", 7) == 0) stack[sp++] = i;
    else if (strcmp(tmp.s, "END") == 0) {
      if (sp == 0) { evl_line_error(res, i + 1, "END without REPEAT", NULL, NULL); goto finish; }
      sp--;
      jumps[i] = stack[sp]; jumps[stack[sp]] = i;
    }
  }
  if (sp > 0) { res->ok = 0; evl_str_clear(&res->error); evl_str_add(&res->error, "Missing END for REPEAT"); goto finish; }

  pc = 0;
  while (pc < nlines) {
    if (++steps > 500) {
      res->ok = 0; evl_str_clear(&res->error); evl_str_add(&res->error, "Stopped after 500 steps (loop limit)");
      evl_render_grid(grid, tx, ty, &res->grid);
      goto finish;
    }
    evl_trim_copy(lines[pc], strlen(lines[pc]), &raw);
    if (raw.n == 0 || raw.s[0] == '#') { pc++; continue; }
    evl_str_clear(&upper); evl_str_add(&upper, raw.s); evl_upper(upper.s);

    if (strncmp(upper.s, "IF ", 3) == 0) {
      char *then = strstr(upper.s, " THEN ");
      EvlVal cond;
      char *condtxt;
      int truth;
      if (!then) { evl_line_error(res, pc + 1, "IF needs THEN", NULL, NULL); goto finish; }
      condtxt = evl_strndup(raw.s + 3, (size_t)(then - upper.s) - 3);
      evl_eval_expr(condtxt, &res->vars, &cond);
      truth = evl_val_true(&cond);
      evl_val_free(&cond); free(condtxt);
      if (!truth) { pc++; continue; }
      evl_trim_copy(raw.s + (then - upper.s) + 6, strlen(raw.s + (then - upper.s) + 6), &tmp);
      evl_str_clear(&raw); evl_str_add(&raw, tmp.s);
      evl_str_clear(&upper); evl_str_add(&upper, raw.s); evl_upper(upper.s);
    }

    if (strncmp(upper.s, "LET ", 4) == 0) {
      char *eq = strchr(raw.s, '=');
      EvlVal v;
      EvlStr name;
      size_t k;
      int good;
      if (!eq) { evl_line_error(res, pc + 1, "LET needs '='", NULL, NULL); goto finish; }
      evl_str_init(&name);
      evl_trim_copy(raw.s + 4, (size_t)(eq - raw.s) - 4, &name);
      good = name.n > 0 && (isalpha((unsigned char)name.s[0]) || name.s[0] == '_');
      for (k = 1; good && k < name.n; k++) if (!(isalnum((unsigned char)name.s[k]) || name.s[k] == '_')) good = 0;
      if (!good) {
        evl_line_error(res, pc + 1, "bad variable name '", name.s, "'");
        evl_str_free(&name);
        goto finish;
      }
      evl_upper(name.s);
      evl_eval_expr(eq + 1, &res->vars, &v);
      evl_vars_set(&res->vars, name.s, &v);
      evl_val_free(&v);
      evl_str_free(&name);
    } else if (strncmp(upper.s, "PRINT ", 6) == 0) {
      EvlVal v;
      EvlStr t;
      evl_eval_expr(raw.s + 6, &res->vars, &v);
      evl_str_init(&t);
      evl_val_text(&v, &t);
      evl_list_add(&res->output, t.s);
      evl_str_free(&t); evl_val_free(&v);
    } else if (strcmp(upper.s, "CLEAR") == 0) {
      for (rr = 0; rr < 12; rr++) for (cc = 0; cc < 12; cc++) grid[rr][cc] = '.';
      tx = 4; ty = 4; dir = 0; grid[ty][tx] = '#';
    } else if (strncmp(upper.s, "MOVE ", 5) == 0) {
      EvlVal v;
      double d;
      int dist, m;
      evl_eval_expr(raw.s + 5, &res->vars, &v);
      d = floor(evl_val_to_num(&v));
      evl_val_free(&v);
      if (d > 20) d = 20;
      if (d < 0) d = 0;
      dist = (int)d;
      for (m = 0; m < dist; m++) {
        tx += dx[dir]; ty += dy[dir];
        if (tx < 0) tx = 0;
        if (tx > 11) tx = 11;
        if (ty < 0) ty = 0;
        if (ty > 11) ty = 11;
        grid[ty][tx] = '#';
      }
    } else if (strncmp(upper.s, "TURN ", 5) == 0) {
      evl_trim_copy(upper.s + 5, strlen(upper.s + 5), &tmp);
      dir = (strcmp(tmp.s, "LEFT") == 0) ? (dir + 3) % 4 : (dir + 1) % 4;
    } else if (strncmp(upper.s, "REPEAT ", 7) == 0) {
      EvlVal v;
      double cnt;
      evl_eval_expr(raw.s + 7, &res->vars, &v);
      cnt = floor(evl_val_to_num(&v));
      evl_val_free(&v);
      if (cnt < 0) cnt = 0;
      if (cnt == 0 && jumps[pc] >= 0) { pc = jumps[pc] + 1; continue; }
      counters[pc] = cnt;
    } else if (strcmp(upper.s, "END") == 0) {
      int head = jumps[pc];
      if (head >= 0) {
        counters[head] -= 1;
        if (counters[head] > 0) { pc = head + 1; continue; }
      }
    } else {
      evl_line_error(res, pc + 1, "Unknown command '", raw.s, "'");
      goto finish;
    }
    pc++;
  }
  res->ok = 1;
  evl_render_grid(grid, tx, ty, &res->grid);

finish:
  for (i = 0; i < nlines; i++) free(lines[i]);
  free(lines); free(jumps); free(stack); free(counters);
  evl_str_free(&raw); evl_str_free(&upper); evl_str_free(&tmp);
}

/* ======================================================================
   adventure
   ====================================================================== */
static const EvlRoomDef *evl_room_of(const EvlProfile *p)
{
  int i;
  for (i = 0; i < EVL_NROOMS; i++) if (strcmp(EVL_ROOMS[i].id, p->room) == 0) return &EVL_ROOMS[i];
  return &EVL_ROOMS[0];
}

void evl_adv_look(const EvlProfile *p, EvlStr *out)
{
  const EvlRoomDef *r = evl_room_of(p);
  int solved = evl_list_has(&p->solved, r->pid);
  evl_str_add(out, "== "); evl_str_add(out, r->title); evl_str_add(out, " ==\n");
  evl_str_add(out, r->desc); evl_str_addc(out, '\n');
  if (solved) { evl_str_add(out, "[Solved! Reward: "); evl_str_add(out, r->reward); evl_str_addc(out, ']'); }
  else evl_str_add(out, r->prompt);
  evl_str_add(out, "\nCommands: GO <dir>, ANSWER <text>, HINT");
}

static void evl_lower(char *s) { for (; *s; s++) *s = (char)tolower((unsigned char)*s); }

void evl_adv_command(EvlProfile *p, const EvlLib *lib, const char *cmd, EvlStr *out)
{
  const EvlRoomDef *r = evl_room_of(p);
  EvlStr raw, up, ans;
  int i;
  evl_str_init(&raw); evl_str_init(&up); evl_str_init(&ans);
  evl_trim_copy(cmd, strlen(cmd), &raw);
  evl_str_add(&up, raw.s); evl_upper(up.s);

  if (up.n == 0 || strcmp(up.s, "LOOK") == 0) { evl_adv_look(p, out); goto done; }
  if (strncmp(up.s, "GO ", 3) == 0) {
    EvlStr dir;
    evl_str_init(&dir);
    evl_trim_copy(raw.s + 3, strlen(raw.s + 3), &dir);
    evl_lower(dir.s);
    for (i = 0; i < r->nexits; i++) {
      if (strcmp(r->exit_dir[i], dir.s) == 0) {
        evl_copy_cap(p->room, sizeof(p->room), r->exit_room[i]);
        evl_adv_look(p, out);
        evl_str_free(&dir);
        goto done;
      }
    }
    evl_str_add(out, "You can't go '"); evl_str_add(out, dir.s); evl_str_add(out, "'. Exits: ");
    for (i = 0; i < r->nexits; i++) { if (i) evl_str_add(out, ", "); evl_str_add(out, r->exit_dir[i]); }
    evl_str_free(&dir);
    goto done;
  }
  if (strcmp(up.s, "HINT") == 0) {
    int ids[1];
    if (evl_lib_search(lib, r->hint, 1, ids) > 0) {
      EvlStr fact, ex;
      evl_str_init(&fact); evl_str_init(&ex);
      evl_lib_read(lib, ids[0], &fact, &ex);
      evl_str_add(out, "[Library Hint - "); evl_str_add(out, lib->rec[ids[0]].topic); evl_str_add(out, "] ");
      evl_str_add(out, fact.s);
      if (ex.n) { evl_str_add(out, "\nExample: "); evl_str_add(out, ex.s); }
      evl_str_free(&fact); evl_str_free(&ex);
    } else { evl_str_add(out, "Try checking the Library for: "); evl_str_add(out, r->hint); }
    goto done;
  }
  evl_str_add(&ans, strncmp(up.s, "ANSWER ", 7) == 0 ? raw.s + 7 : raw.s);
  evl_lower(ans.s);
  for (i = 0; i < r->nkw; i++) {
    if (strstr(ans.s, r->kw[i])) {
      if (!evl_list_has(&p->solved, r->pid)) {
        evl_list_add(&p->solved, r->pid);
        evl_list_add(&p->inv, r->reward);
        evl_pm_record(p, r->hint, r->xp);
      }
      evl_str_add(out, "CORRECT! Unlocked: "); evl_str_add(out, r->reward);
      evl_str_add(out, "\nXP: "); evl_str_addi(out, p->xp);
      goto done;
    }
  }
  evl_str_add(out, "Not quite! Type HINT to pull knowledge from the compressed library, or try again.");
done:
  evl_str_free(&raw); evl_str_free(&up); evl_str_free(&ans);
}

/* ======================================================================
   tutor
   ====================================================================== */
/* "what is 18*4 ?" : optional "what is ", digits, one operator, digits. Returns the expression text or NULL. */
static char *evl_match_arithmetic(const char *q)
{
  const char *p = q, *start;
  size_t n;
  if ((p[0] == 'w' || p[0] == 'W') && (p[1] == 'h' || p[1] == 'H') && (p[2] == 'a' || p[2] == 'A') && (p[3] == 't' || p[3] == 'T') &&
      p[4] == ' ' && (p[5] == 'i' || p[5] == 'I') && (p[6] == 's' || p[6] == 'S') && p[7] == ' ') {
    p += 7;
    while (*p == ' ') p++;
  }
  start = p;
  if (!isdigit((unsigned char)*p)) return NULL;
  while (isdigit((unsigned char)*p)) p++;
  while (*p == ' ') p++;
  if (!(*p == '+' || *p == '-' || *p == '*' || *p == '/' || *p == '%')) return NULL;
  p++;
  while (*p == ' ') p++;
  if (!isdigit((unsigned char)*p)) return NULL;
  while (isdigit((unsigned char)*p)) p++;
  n = (size_t)(p - start);
  while (*p == ' ') p++;
  if (*p == '?') p++;
  while (*p == ' ') p++;
  if (*p) return NULL;
  return evl_strndup(start, n);
}

static const char *evl_format_modality(EvlProfile *p, const char *question, const char *topic, const char *fact, const char *ex,
                                       const char *nn, EvlStr *out)
{
  char mode = p->mode;
  EvlStr speak;
  size_t k;
  if (!topic) {
    if (nn && nn[0]) { evl_str_add(out, nn); return "TNY2 Neural Weights"; }
    evl_str_add(out, "I could not find '"); evl_str_add(out, question);
    evl_str_add(out, "' in the local Library yet. Try importing a .txt encyclopedia or asking about science, math, survival, or coding!");
    return "Offline Guide";
  }
  if (mode == 'R') {
    evl_str_add(out, "[READ] ");
    for (k = 0; topic[k]; k++) evl_str_addc(out, toupper((unsigned char)topic[k]));
    evl_str_addc(out, '\n'); evl_str_add(out, fact);
    if (ex[0]) { evl_str_add(out, "\nNote: "); evl_str_add(out, ex); }
  } else if (mode == 'A') {
    evl_str_add(out, "[AUDIO] "); evl_str_add(out, fact);
    if (ex[0]) { evl_str_add(out, " Example: "); evl_str_add(out, ex); }
  } else if (mode == 'D') {
    evl_str_add(out, "[DO] Try applying '"); evl_str_add(out, topic); evl_str_add(out, "':\n");
    if (ex[0]) { evl_str_add(out, "Action: "); evl_str_add(out, ex); } else { evl_str_add(out, "Fact: "); evl_str_add(out, fact); }
    evl_str_add(out, "\nMini-Check: Can you explain '"); evl_str_add(out, topic);
    evl_str_add(out, "' in your own words or test it in Code/Adventure?");
  } else {
    evl_str_add(out, "[MIX] "); evl_str_add(out, fact);
    if (ex[0]) { evl_str_add(out, "\nApplied Example: "); evl_str_add(out, ex); }
    if (nn && nn[0]) { evl_str_add(out, "\nTiny-Net says: "); evl_str_add(out, nn); }
  }
  evl_str_init(&speak);
  evl_str_add(&speak, fact);
  if (ex[0]) { evl_str_add(&speak, " Example: "); evl_str_add(&speak, ex); }
  evl_audio_speak(speak.s, mode);
  evl_str_free(&speak);
  evl_pm_record(p, topic, -1);
  return (nn && nn[0]) ? "Library + TNY2" : "Compressed Library";
}

const char *evl_tutor_ask(const EvlLib *lib, EvlProfile *p, EvlModel *m, const char *question, EvlStr *text)
{
  EvlStr q, nn, fact, ex, prompt;
  char *expr;
  const char *src;
  int ids[1], nh;
  evl_str_init(&q); evl_str_init(&nn); evl_str_init(&fact); evl_str_init(&ex); evl_str_init(&prompt);
  evl_clean_ascii(question, &q);
  evl_list_add(&p->recent, q.s);
  if (p->recent.n > 20) evl_list_drop_first(&p->recent);

  expr = evl_match_arithmetic(q.s);
  if (expr) {
    EvlVal v;
    EvlStr f2, e2;
    char num[48];
    evl_eval_expr(expr, NULL, &v);
    evl_fmt_num(evl_val_to_num(&v), num);
    evl_val_free(&v);
    evl_str_init(&f2); evl_str_init(&e2);
    evl_str_add(&f2, expr); evl_str_add(&f2, " = "); evl_str_add(&f2, num);
    evl_str_add(&e2, "If you split or group "); evl_str_add(&e2, expr); evl_str_add(&e2, ", the result is "); evl_str_add(&e2, num); evl_str_addc(&e2, '.');
    src = evl_format_modality(p, q.s, "arithmetic", f2.s, e2.s, "", text);
    evl_str_free(&f2); evl_str_free(&e2); free(expr);
    goto done;
  }
  nh = evl_lib_search(lib, q.s, 1, ids);
  if (nh > 0) evl_lib_read(lib, ids[0], &fact, &ex);
  if (m && m->loaded) {
    if (nh > 0) {
      evl_str_addc(&prompt, p->mode); evl_str_addc(&prompt, ':');
      evl_str_addn(&prompt, fact.s, fact.n < 40 ? fact.n : 40);
      evl_str_addc(&prompt, '|');
      evl_str_addn(&prompt, q.s, q.n < 30 ? q.n : 30);
    } else evl_str_add(&prompt, q.s);
    evl_model_think(m, prompt.s, 0, &nn);
  }
  src = evl_format_modality(p, q.s, nh > 0 ? lib->rec[ids[0]].topic : NULL, fact.s, ex.s, nn.s, text);
done:
  evl_str_free(&q); evl_str_free(&nn); evl_str_free(&fact); evl_str_free(&ex); evl_str_free(&prompt);
  return src;
}

/* ======================================================================
   multi-shelf check
   ====================================================================== */
void evl_multi_init(EvlMulti *m) { m->shelf = NULL; m->n = 0; }
void evl_multi_free(EvlMulti *m)
{
  int i;
  for (i = 0; i < m->n; i++) { free(m->shelf[i].name); evl_lib_free(&m->shelf[i].lib); }
  free(m->shelf);
  m->shelf = NULL; m->n = 0;
}

EvlLib *evl_multi_shelf(EvlMulti *m, const char *name)
{
  int i;
  for (i = 0; i < m->n; i++) if (strcmp(m->shelf[i].name, name) == 0) return &m->shelf[i].lib;
  m->shelf = (EvlShelf *)evl_grow(m->shelf, (size_t)(m->n + 1) * sizeof(EvlShelf));
  m->shelf[m->n].name = evl_strdup(name);
  evl_lib_init(&m->shelf[m->n].lib);
  m->n++;
  return &m->shelf[m->n - 1].lib;
}

static void evl_lower_into(EvlStr *dst, const char *s)
{
  for (; *s; s++) evl_str_addc(dst, tolower((unsigned char)*s));
}

void evl_swarm_ask(EvlMulti *m, const EvlProfile *p, EvlModel *model, const char *question, const char *shelves,
                   EvlStr *answer, EvlStr *sources, EvlList *chat)
{
  EvlList names, hitSrc, hitTopic, hitFact, hitEx, cites;
  EvlStr draft, hint, combined, stripped, line, f, e;
  int i, nh, ok = 1, k;
  evl_list_init(&names); evl_list_init(&hitSrc); evl_list_init(&hitTopic); evl_list_init(&hitFact); evl_list_init(&hitEx);
  evl_list_init(&cites);
  evl_str_init(&draft); evl_str_init(&hint); evl_str_init(&combined); evl_str_init(&stripped); evl_str_init(&line);
  evl_str_init(&f); evl_str_init(&e);

  if (!shelves || strcmp(shelves, "*") == 0 || !shelves[0]) {
    for (i = 0; i < m->n; i++) evl_list_add(&names, m->shelf[i].name);
  } else {
    const char *s = shelves, *c;
    for (;;) {
      char *nm;
      c = strchr(s, ',');
      nm = evl_strndup(s, c ? (size_t)(c - s) : strlen(s));
      evl_list_add(&names, nm); free(nm);
      if (!c) break;
      s = c + 1;
    }
  }
  for (i = 0; i < names.n; i++) {
    int si, ids[1];
    for (si = 0; si < m->n; si++) if (strcmp(m->shelf[si].name, names.v[i]) == 0) break;
    if (si == m->n) continue;
    if (evl_lib_search(&m->shelf[si].lib, question, 1, ids) > 0) {
      EvlStr src;
      evl_str_init(&src);
      evl_str_add(&src, names.v[i]); evl_str_addc(&src, '#'); evl_str_addi(&src, ids[0]);
      evl_list_add(&hitSrc, src.s);
      evl_str_free(&src);
      evl_list_add(&hitTopic, m->shelf[si].lib.rec[ids[0]].topic);
      evl_lib_read(&m->shelf[si].lib, ids[0], &f, &e);
      evl_list_add(&hitFact, f.s);
      evl_list_add(&hitEx, e.s);
    }
  }
  nh = hitSrc.n;

  for (i = 0; i < nh; i++) {
    if (i) evl_str_addc(&draft, '\n');
    evl_str_add(&draft, hitFact.v[i]);
    if (hitEx.v[i][0]) { evl_str_add(&draft, " (Example: "); evl_str_add(&draft, hitEx.v[i]); evl_str_addc(&draft, ')'); }
    evl_str_add(&draft, " ["); evl_str_add(&draft, hitSrc.v[i]); evl_str_addc(&draft, ']');
  }
  if (model && model->loaded && nh > 0) {
    EvlStr prompt;
    evl_str_init(&prompt);
    evl_str_addc(&prompt, p->mode); evl_str_addc(&prompt, ':');
    evl_str_addn(&prompt, hitFact.v[0], strlen(hitFact.v[0]) < 40 ? strlen(hitFact.v[0]) : 40);
    evl_str_addc(&prompt, '|');
    evl_str_addn(&prompt, question, strlen(question) < 30 ? strlen(question) : 30);
    evl_model_think(model, prompt.s, 0, &hint);
    evl_str_free(&prompt);
    if (hint.n) { evl_str_addc(&draft, '\n'); evl_str_add(&draft, "Tiny-Net Note: "); evl_str_add(&draft, hint.s); }
  }

  /* the checker */
  evl_str_clear(&line);
  evl_str_add(&line, "Drafter: Proposed answer using "); evl_str_addi(&line, nh); evl_str_add(&line, " source(s).");
  evl_list_add(chat, line.s);
  if (nh == 0) {
    evl_list_add(chat, "Checker: REJECTED - no matching source in persistent library.");
    ok = 0;
  } else {
    const char *d;
    for (i = 0; i < nh; i++) {
      evl_str_addc(&combined, ' '); evl_lower_into(&combined, hitFact.v[i]);
      evl_str_addc(&combined, ' '); evl_lower_into(&combined, hitEx.v[i]);
      evl_str_clear(&line);
      evl_str_addc(&line, '['); evl_str_add(&line, hitSrc.v[i]); evl_str_add(&line, ": "); evl_str_add(&line, hitTopic.v[i]); evl_str_addc(&line, ']');
      evl_list_add(&cites, line.s);
    }
    /* draft without its [source] tags */
    for (d = draft.s; *d; ) {
      if (*d == '[') {
        const char *close = strchr(d, ']');
        if (close) { evl_str_addc(&stripped, ' '); d = close + 1; continue; }
      }
      evl_str_addc(&stripped, *d); d++;
    }
    for (d = stripped.s; *d && ok; ) {
      if (isdigit((unsigned char)*d)) {
        const char *s = d;
        char *num;
        while (isdigit((unsigned char)*d)) d++;
        if (*d == '.' && isdigit((unsigned char)d[1])) { d++; while (isdigit((unsigned char)*d)) d++; }
        num = evl_strndup(s, (size_t)(d - s));
        if (!strstr(combined.s, num)) {
          evl_str_clear(&line);
          evl_str_add(&line, "Checker: WARNING - number '"); evl_str_add(&line, num);
          evl_str_add(&line, "' not backed by source; clamping to source text.");
          evl_list_add(chat, line.s);
          ok = 0;
        }
        free(num);
      } else d++;
    }
    if (ok) {
      evl_str_clear(&line);
      evl_str_add(&line, "Checker: VERIFIED against ");
      for (k = 0; k < cites.n; k++) { if (k) evl_str_add(&line, ", "); evl_str_add(&line, cites.v[k]); }
      evl_list_add(chat, line.s);
    }
  }
  evl_str_clear(answer);
  if (ok) evl_str_add(answer, draft.s);
  else {
    for (i = 0; i < nh; i++) {
      if (i) evl_str_addc(answer, '\n');
      evl_str_add(answer, hitFact.v[i]); evl_str_add(answer, " ["); evl_str_add(answer, hitSrc.v[i]); evl_str_addc(answer, ']');
    }
  }
  if (answer->n == 0) evl_str_add(answer, "No verified source found across shelves. Try importing a .txt module for this topic.");
  evl_str_clear(sources);
  for (k = 0; k < cites.n; k++) { if (k) evl_str_addc(sources, ' '); evl_str_add(sources, cites.v[k]); }

  evl_list_free(&names); evl_list_free(&hitSrc); evl_list_free(&hitTopic); evl_list_free(&hitFact); evl_list_free(&hitEx);
  evl_list_free(&cites);
  evl_str_free(&draft); evl_str_free(&hint); evl_str_free(&combined); evl_str_free(&stripped); evl_str_free(&line);
  evl_str_free(&f); evl_str_free(&e);
}

/* ======================================================================
   packets and the quantized dot product
   ====================================================================== */
static long evl_round_half_up(double v) { return (long)floor(v + 0.5); }
static int evl_clamp16(long v) { return v > 32767 ? 32767 : (v < -32768L ? -32768 : (int)v); }
static void evl_put_i16(unsigned char *p, int v) { unsigned u = (unsigned)(v & 0xFFFF); p[0] = (unsigned char)(u & 255); p[1] = (unsigned char)(u >> 8); }
static int evl_get_i16(const unsigned char *p) { long u = (long)p[0] | ((long)p[1] << 8); return (int)(u >= 32768L ? u - 65536L : u); }

void evl_net_pack_frame(unsigned char *o, int id, double x, double y, double vx, double vy, int buttons, int seq)
{
  o[0] = (unsigned char)(id & 255);
  o[1] = (unsigned char)(buttons & 255);
  o[2] = (unsigned char)(seq & 255); o[3] = (unsigned char)((seq >> 8) & 255);
  evl_put_i16(o + 4, evl_clamp16(evl_round_half_up(x * 16)));
  evl_put_i16(o + 6, evl_clamp16(evl_round_half_up(y * 16)));
  evl_put_i16(o + 8, evl_clamp16(evl_round_half_up(vx * 256)));
  evl_put_i16(o + 10, evl_clamp16(evl_round_half_up(vy * 256)));
}

void evl_net_unpack_frame(const unsigned char *in, int *id, int *buttons, int *seq, double *x, double *y, double *vx, double *vy)
{
  *id = in[0]; *buttons = in[1]; *seq = in[2] | (in[3] << 8);
  *x = evl_get_i16(in + 4) / 16.0; *y = evl_get_i16(in + 6) / 16.0;
  *vx = evl_get_i16(in + 8) / 256.0; *vy = evl_get_i16(in + 10) / 256.0;
}

size_t evl_net_pack_brain(const double *w, int n, unsigned char *out)
{
  double big = 0.0, scale;
  int i;
  for (i = 0; i < n; i++) { double a = w[i] < 0 ? -w[i] : w[i]; if (a > big) big = a; }
  scale = big > 1e-8 ? big / 127.0 : 1.0;
  evl_wr_u16(out, (unsigned)n);
  evl_wr_f32(out + 2, (float)scale);
  for (i = 0; i < n; i++) {
    long q = evl_round_half_up(w[i] / scale);
    if (q > 127) q = 127;
    if (q < -127) q = -127;
    out[6 + i] = (unsigned char)(q & 255);
  }
  return 6 + (size_t)n;
}

int evl_net_unpack_brain(const unsigned char *in, size_t len, double *w, int cap)
{
  int n, i;
  float scale;
  if (len < 6) return -1;
  n = in[0] | (in[1] << 8);
  scale = evl_rd_f32(in + 2);
  if ((size_t)n + 6 > len || n > cap) return -1;
  for (i = 0; i < n; i++) {
    int q = in[6 + i];
    if (q > 127) q -= 256;
    w[i] = (double)(float)((double)q * (double)scale);
  }
  return n;
}

double evl_quant_dot(const double *q, const signed char *k, int koff, double kscale, int len)
{
  int i;
  double big = 0.0, qscale, invq;
  long acc = 0;
  for (i = 0; i < len; i++) { double a = q[i] < 0 ? -q[i] : q[i]; if (a > big) big = a; }
  if (big < 1e-20) return 0.0;
  qscale = big / 127.0;
  invq = 127.0 / big;
  for (i = 0; i < len; i++) acc += (long)(q[i] * invq) * (long)k[koff + i];
  return (double)acc * qscale * kscale;
}
