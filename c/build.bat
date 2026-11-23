@echo off
rem Builds the C edition with Visual Studio's compiler. Run from the c folder.
rem   build.bat           builds evelyn.exe, evelyn_proto.exe, evelyn_test.exe into .\out
rem Other compilers: see the Makefile (gcc or any C89 compiler).
setlocal
if not exist out mkdir out

where cl >nul 2>nul
if not errorlevel 1 goto compile

set "VCVARS="
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
if exist "%PF%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%PF%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%PF%\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%PF%\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%PF%\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%PF%\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%PF86%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%PF86%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%PF86%\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%PF86%\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS goto nocl
call "%VCVARS%" >nul

:compile
set CFLAGS=/nologo /O2 /W3 /D_CRT_SECURE_NO_WARNINGS /Foout\
cl %CFLAGS% /Feout\evelyn.exe       evelyn_cli.c evelyn.c   || exit /b 1
cl %CFLAGS% /Feout\evelyn_proto.exe evelyn_proto.c evelyn.c || exit /b 1
cl %CFLAGS% /Feout\evelyn_test.exe  evelyn_test.c evelyn.c  || exit /b 1
echo built into out\
exit /b 0

:nocl
echo cl.exe not found. Open a Developer Command Prompt, or use the Makefile with gcc.
exit /b 1
