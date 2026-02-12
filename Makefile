.PHONY: lint lint-fix

SOURCES := $(wildcard src/*.ts)

pr-review: $(SOURCES)
	bun build --compile --outfile=pr-review src/cli.ts

lint:
	npx biome check src/

lint-fix:
	npx biome check --write src/
