#!/bin/sh
# Builds the BASIC edition with FreeBASIC (https://www.freebasic.net). Run from this folder.
#   ./build.sh      makes ./evelyn and ./evelyn_proto
# Needs fbc on the PATH. The sources are written for the QuickBASIC dialect (-lang qb).
set -e
fbc -lang qb evelyn.bas
fbc -lang qb evelyn_proto.bas
echo "built evelyn and evelyn_proto"
