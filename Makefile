.PHONY: lint lint-fix clean

SOURCES := $(wildcard src/*.ts)

pr-review: dist/cli.js
	bun build --compile --outfile=pr-review dist/cli.js

dist/cli.js: $(SOURCES) build.ts
	bun run build.ts

lint:
	npx biome check src/

lint-fix:
	npx biome check --write src/

clean:
	rm -rf dist pr-review
