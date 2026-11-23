# Evelyn C edition. Needs only a C compiler and the math library.
#   make            builds out/evelyn, out/evelyn_proto, out/evelyn_test
#   make test       runs the C unit tests
# -ffp-contract=off keeps the floating point results identical to the JavaScript edition.
CC      ?= gcc
CFLAGS  ?= -O2 -std=c89 -pedantic -Wall -Wextra -ffp-contract=off
LDLIBS  = -lm

all: out/evelyn out/evelyn_proto out/evelyn_test

out:
	mkdir -p out

out/evelyn: out evelyn_cli.c evelyn.c evelyn.h evelyn_data.h
	$(CC) $(CFLAGS) -o $@ evelyn_cli.c evelyn.c $(LDLIBS)

out/evelyn_proto: out evelyn_proto.c evelyn.c evelyn.h evelyn_data.h
	$(CC) $(CFLAGS) -o $@ evelyn_proto.c evelyn.c $(LDLIBS)

out/evelyn_test: out evelyn_test.c evelyn.c evelyn.h evelyn_data.h
	$(CC) $(CFLAGS) -o $@ evelyn_test.c evelyn.c $(LDLIBS)

test: out/evelyn_test
	./out/evelyn_test

clean:
	rm -rf out
