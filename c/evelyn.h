/* evelyn.h - Evelyn and her Echoes, C edition.

   Same behaviour as the JavaScript reference (js/evelyn_core.js): LZW library,
   TNY2 neural engine with KV21 cache sharing, learner profile, adventure,
   coding sandbox, multi-shelf check and the packet codecs.

   Written in C89 style so it builds with old compilers; tested with MSVC.
   No dependencies beyond the C library. */
#ifndef EVELYN_H
#define EVELYN_H

#include <stddef.h>

#define EVL_VOCAB 97
#define EVL_CTX   128
#define EVL_MAXL  16

#if defined(__TURBOC__) || defined(__MSDOS__)
typedef unsigned long evl_u32;
#else
typedef unsigned int evl_u32;
#endif

/* ---------- growing string and string list ---------- */
typedef struct { char *s; size_t n; size_t cap; } EvlStr;
void  evl_str_init(EvlStr *b);
void  evl_str_free(EvlStr *b);
void  evl_str_clear(EvlStr *b);
void  evl_str_addn(EvlStr *b, const char *s, size_t n);
void  evl_str_add(EvlStr *b, const char *s);
void  evl_str_addc(EvlStr *b, int c);
void  evl_str_addi(EvlStr *b, long v);
char *evl_strdup(const char *s);

typedef struct { char **v; int n; int cap; } EvlList;
void evl_list_init(EvlList *l);
void evl_list_free(EvlList *l);
void evl_list_clear(EvlList *l);
void evl_list_add(EvlList *l, const char *s);
int  evl_list_has(const EvlList *l, const char *s);
void evl_list_drop_first(EvlList *l);
void evl_list_join(const EvlList *l, EvlStr *out);          /* joins with '|', '|' and newlines inside items become spaces */
void evl_list_split(EvlList *l, const char *s);             /* splits on '|' */

int  evl_read_file(const char *path, EvlStr *out);          /* 0 ok, -1 missing */
int  evl_write_file(const char *path, const char *data, size_t n);

/* ---------- text helpers ---------- */
void   evl_fmt_num(double x, char *out);                    /* out: at least 40 bytes */
double evl_val_of(const char *s);
void   evl_clean_ascii(const char *in, EvlStr *out);       /* input is UTF-8 */
void   evl_tokenize_words(const char *text, EvlList *out);

typedef struct { evl_u32 state; } EvlRng;
void   evl_rng_seed(EvlRng *r, evl_u32 seed);
double evl_rng_next(EvlRng *r);

/* ---------- LZW and base64 ---------- */
size_t evl_lz_compress(const char *in, unsigned char **out);          /* returns byte count, *out from malloc */
int    evl_lz_decompress(const unsigned char *in, size_t n, EvlStr *out);   /* 0 ok, -1 corrupt */
void   evl_b64_encode(const unsigned char *in, size_t n, EvlStr *out);
size_t evl_b64_decode(const char *in, unsigned char **out);

/* ---------- library ---------- */
typedef struct {
  char *topic, *topic_lc, *cat, *zfact, *zex;
  EvlList words;
} EvlRecord;
typedef struct { EvlRecord *rec; int n; int cap; } EvlLib;

void evl_lib_init(EvlLib *lib);
void evl_lib_free(EvlLib *lib);
void evl_lib_clear(EvlLib *lib);
int  evl_lib_add(EvlLib *lib, const char *topic, const char *cat, const char *fact, const char *ex);
void evl_lib_starter(EvlLib *lib);
int  evl_lib_ingest(EvlLib *lib, const char *raw, const char *label);
int  evl_lib_search(const EvlLib *lib, const char *query, int topk, int *ids);   /* returns hit count */
void evl_lib_read(const EvlLib *lib, int id, EvlStr *fact, EvlStr *ex);
void evl_lib_stats(const EvlLib *lib, long *entries, long *chars);
void evl_lib_to_text(const EvlLib *lib, EvlStr *out);
int  evl_lib_from_text(EvlLib *lib, const char *text);

/* ---------- TNY2 model ---------- */
typedef struct { int rows, cols; float *scale; signed char *w; } EvlTable;
typedef struct {
  int loaded, D, L, H, HD, HID, kv_prefix;
  double att_div;
  EvlTable emb, pos, wq[EVL_MAXL], wk[EVL_MAXL], wv[EVL_MAXL], wo[EVL_MAXL], f1[EVL_MAXL], f2[EVL_MAXL];
  float *g1[EVL_MAXL], *g2[EVL_MAXL], *gf;
  signed char *kc[EVL_MAXL], *vc[EVL_MAXL];
  float *ks[EVL_MAXL], *vs[EVL_MAXL];
  float *bx, *bh, *bq, *bt, *ba, *bm, *bs;
  float score[EVL_VOCAB];
  EvlRng rng;
} EvlModel;

/* load returns 0 ok, 1 not TNY2, 2 header out of range, 3 truncated */
void   evl_model_init(EvlModel *m);
void   evl_model_free(EvlModel *m);
int    evl_model_load(EvlModel *m, const unsigned char *buf, size_t n);
long   evl_tny2_size(int D, int L, int HID);
void   evl_model_step(EvlModel *m, int tok, int p);
int    evl_model_pick(EvlModel *m, double creativity);
void   evl_model_reset(EvlModel *m);
int    evl_model_prime(EvlModel *m, const char *text);
void   evl_model_think(EvlModel *m, const char *question, double creativity, EvlStr *out);
size_t evl_model_kv_export(const EvlModel *m, int seq_len, unsigned char **out);
int    evl_model_kv_import(EvlModel *m, const unsigned char *buf, size_t n);   /* returns length, or -1 */

/* ---------- profile ---------- */
typedef struct {
  char name[64], pace[32], mode, room[16];
  long xp, fb[4];
  EvlList solved, inv, mastered, recent;
} EvlProfile;
void evl_pm_init(EvlProfile *p);
void evl_pm_free(EvlProfile *p);
void evl_pm_reset(EvlProfile *p);
char evl_pm_set_mode(EvlProfile *p, const char *m);
void evl_pm_record(EvlProfile *p, const char *topic, long bonus_xp);       /* bonus_xp < 0 means the default 10 */
char evl_pm_best(const EvlProfile *p);
void evl_pm_to_cfg(const EvlProfile *p, EvlStr *out);
void evl_pm_from_cfg(EvlProfile *p, const char *text);

/* ---------- audio ---------- */
extern EvlStr evl_last_spoken;
extern void (*evl_tone_hook)(int freq, int ms);
int  evl_chirp_plan(const char *text, int *freqs);                          /* up to 14 notes, returns count */
void evl_audio_speak(const char *text, char mode);

/* ---------- coding sandbox ---------- */
typedef struct { int is_str; double num; char *str; } EvlVal;
typedef struct { char *name; EvlVal val; } EvlVar;
typedef struct { EvlVar *v; int n; int cap; } EvlVars;
typedef struct { int ok; EvlStr error; EvlList output; EvlStr grid; EvlVars vars; } EvlRun;

void evl_vars_init(EvlVars *v);
void evl_vars_free(EvlVars *v);
void evl_val_free(EvlVal *v);
void evl_eval_expr(const char *expr, EvlVars *vars, EvlVal *out);
void evl_val_text(const EvlVal *v, EvlStr *out);
void evl_run_init(EvlRun *r);
void evl_run_free(EvlRun *r);
void evl_run_code(const char *source, EvlRun *r);

/* ---------- adventure and tutor ---------- */
void evl_adv_look(const EvlProfile *p, EvlStr *out);
void evl_adv_command(EvlProfile *p, const EvlLib *lib, const char *cmd, EvlStr *out);
const char *evl_tutor_ask(const EvlLib *lib, EvlProfile *p, EvlModel *m, const char *question, EvlStr *text);   /* returns the source label */

/* ---------- multi-shelf check ---------- */
typedef struct { char *name; EvlLib lib; } EvlShelf;
typedef struct { EvlShelf *shelf; int n; } EvlMulti;
void evl_multi_init(EvlMulti *m);
void evl_multi_free(EvlMulti *m);
EvlLib *evl_multi_shelf(EvlMulti *m, const char *name);                    /* finds or creates */
int evl_number_in(const char *hay, const char *num);
void evl_swarm_ask(EvlMulti *m, const EvlProfile *p, EvlModel *model, const char *question, const char *shelves,
                   EvlStr *answer, EvlStr *sources, EvlList *chat);

/* ---------- packets and the quantized dot ---------- */
void   evl_net_pack_frame(unsigned char *out12, int id, double x, double y, double vx, double vy, int buttons, int seq);
void   evl_net_unpack_frame(const unsigned char *in12, int *id, int *buttons, int *seq, double *x, double *y, double *vx, double *vy);
size_t evl_net_pack_brain(const double *w, int n, unsigned char *out);       /* out needs 6 + n bytes */
int    evl_net_unpack_brain(const unsigned char *in, size_t len, double *w, int cap);   /* returns n */
double evl_quant_dot(const double *q, const signed char *k, int koff, double kscale, int len);

#endif
