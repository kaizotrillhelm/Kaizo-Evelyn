@echo off
rem Builds the BASIC edition with FreeBASIC (https://www.freebasic.net). Run from this folder.
rem   build.bat      makes evelyn.exe and evelyn_proto.exe
rem Needs fbc on the PATH. The sources are written for the QuickBASIC dialect (-lang qb).
fbc -lang qb evelyn.bas       || exit /b 1
fbc -lang qb evelyn_proto.bas || exit /b 1
echo built evelyn.exe and evelyn_proto.exe
