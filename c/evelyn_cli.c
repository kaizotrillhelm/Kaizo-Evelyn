/* evelyn_cli.c - Evelyn in a terminal (C edition).
   evelyn [TINY.BIN] [book.txt]
   Keeps USER.CFG (profile) and LIBRARY.EVL (library) in the current folder.
   Commands: /mode R|A|D|M   /adv   /code <lines separated by ;>   /profile   /quit
   Anything else is a question. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef __TURBOC__
#include <dos.h>
static void tone(int freq, int ms) { if (freq > 0) { sound(freq); delay(ms); nosound(); } else delay(ms); }
#elif defined(_WIN32)
#include <windows.h>
static void tone(int freq, int ms) { if (freq >= 37) Beep((DWORD)freq, (DWORD)ms); else Sleep((DWORD)ms); }
#else
static void tone(int freq, int ms) { (void)freq; (void)ms; }
#endif
#include "evelyn.h"

static EvlLib lib;
static EvlProfile pm;
static EvlModel model;

static void save_profile(void)
{
  EvlStr s;
  evl_str_init(&s);
  evl_pm_to_cfg(&pm, &s);
  evl_write_file("USER.CFG", s.s, s.n);
  evl_str_free(&s);
}

static void load_profile(void)
{
  EvlStr s;
  evl_str_init(&s);
  if (evl_read_file("USER.CFG", &s) == 0) evl_pm_from_cfg(&pm, s.s);
  evl_str_free(&s);
}

int main(int argc, char **argv)
{
  EvlStr s, line;
  char buf[512];
  int i, in_adv = 0;

  evl_lib_init(&lib); evl_pm_init(&pm); evl_model_init(&model);
  evl_tone_hook = tone;
  evl_str_init(&s);
  if (evl_read_file("LIBRARY.EVL", &s) == 0 && evl_lib_from_text(&lib, s.s) > 0) {
    /* library loaded from disk */
  } else {
    evl_lib_starter(&lib);
    evl_str_clear(&s);
    evl_lib_to_text(&lib, &s);
    evl_write_file("LIBRARY.EVL", s.s, s.n);
  }
  load_profile();

  for (i = 1; i < argc; i++) {
    evl_str_clear(&s);
    if (evl_read_file(argv[i], &s) != 0) { printf("Cannot read %s\n", argv[i]); continue; }
    {
      size_t n = strlen(argv[i]);
      if (n > 4 && (argv[i][n - 4] == '.') && (argv[i][n - 3] == 'b' || argv[i][n - 3] == 'B')) {
        int rc = evl_model_load(&model, (const unsigned char *)s.s, s.n);
        if (rc == 0) printf("Loaded TNY2: D=%d L=%d H=%d HID=%d\n", model.D, model.L, model.H, model.HID);
        else printf("%s is not a usable TNY2 file (code %d)\n", argv[i], rc);
      } else {
        int c = evl_lib_ingest(&lib, s.s, argv[i]);
        EvlStr t;
        evl_str_init(&t);
        evl_lib_to_text(&lib, &t);
        evl_write_file("LIBRARY.EVL", t.s, t.n);
        evl_str_free(&t);
        printf("Imported %d chunks from %s\n", c, argv[i]);
      }
    }
  }

  printf("EVELYN (C) | learner: %s | mode %c | xp %ld | library entries: %d\n", pm.name, pm.mode, pm.xp, lib.n);
  puts("Commands: /mode R|A|D|M  /adv  /code <lines separated by ;>  /profile  /quit  or ask a question");
  evl_str_init(&line);
  for (;;) {
    char *p;
    size_t len;
    fputs("> ", stdout);
    fflush(stdout);
    if (!fgets(buf, sizeof(buf), stdin)) break;
    len = strlen(buf);
    while (len > 0 && (buf[len - 1] == '\n' || buf[len - 1] == '\r' || buf[len - 1] == ' ')) buf[--len] = '\0';
    p = buf;
    while (*p == ' ') p++;
    if (strcmp(p, "/quit") == 0) break;
    evl_str_clear(&line);
    if (strncmp(p, "/mode ", 6) == 0) { printf("Mode -> %c\n", evl_pm_set_mode(&pm, p + 6)); }
    else if (strcmp(p, "/adv") == 0) {
      in_adv = !in_adv;
      if (in_adv) { evl_adv_look(&pm, &line); puts(line.s); } else puts("Back to the tutor.");
    }
    else if (strcmp(p, "/profile") == 0) { evl_pm_to_cfg(&pm, &line); fputs(line.s, stdout); }
    else if (strncmp(p, "/code ", 6) == 0) {
      EvlRun r;
      char *q;
      int k;
      for (q = p + 6; *q; q++) if (*q == ';') *q = '\n';
      evl_run_init(&r);
      evl_run_code(p + 6, &r);
      if (r.ok) { for (k = 0; k < r.output.n; k++) puts(r.output.v[k]); puts(r.grid.s); }
      else printf("Error: %s\n", r.error.s);
      evl_run_free(&r);
    }
    else if (in_adv) { evl_adv_command(&pm, &lib, p, &line); puts(line.s); }
    else if (*p) {
      const char *src = evl_tutor_ask(&lib, &pm, &model, p, &line);
      printf("%s\n[%s]\n", line.s, src);
    }
  }
  save_profile();
  return 0;
}
