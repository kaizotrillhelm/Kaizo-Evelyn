# Evelyn, C edition

One library (`evelyn.c`, `evelyn.h`) and three programs on top of it. Only the C library and the math library are needed.

```powershell
build.bat                 # Visual Studio compiler; writes out\evelyn.exe, out\evelyn_proto.exe, out\evelyn_test.exe
make                      # gcc (-std=c89 -pedantic -ffp-contract=off); same three programs in out/
out\evelyn_test.exe       # 212 unit tests
out\evelyn.exe [TINY.BIN] [book.txt]
```

`evelyn.exe` keeps `USER.CFG` and `LIBRARY.EVL` in the folder it runs from. Commands: a question, `/mode R|A|D|M`, `/adv`, `/code a;b;c`, `/profile`, `/quit`.

The floating point follows the JavaScript edition step by step: values are stored as 32-bit floats and added up in doubles. Keep `-ffp-contract=off` (gcc) or the default `/fp:precise` (Visual Studio) so the scores stay the same; a compiler that fuses multiply and add can change the last digits.

Using the library from your own code:

```c
EvlLib lib;  EvlProfile pm;  EvlModel model;  EvlStr text;
evl_lib_init(&lib);  evl_lib_starter(&lib);
evl_pm_init(&pm);    evl_model_init(&model);  evl_str_init(&text);
const char *source = evl_tutor_ask(&lib, &pm, &model, "what is gravity", &text);
```

Strings use `EvlStr` (a growing buffer) and lists use `EvlList`; free them with the matching `_free` call. The header documents each function.

Written for DOS-era compilers: C89 declarations and comments, and a `#ifdef __TURBOC__` for the PC speaker in `evelyn_cli.c`. That path was not compiled; only Visual Studio's compiler was available.
