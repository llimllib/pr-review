.PHONY: lint lint-fix clean release

SOURCES := $(wildcard src/*.ts)

pr-review: node_modules/.stamp build/cli.js
	bun build --compile --outfile=pr-review build/cli.js

node_modules/.stamp: package.json bun.lock
	bun install
	touch node_modules/.stamp

build/cli.js: $(SOURCES) build.ts node_modules/.stamp
	bun run build.ts

lint:
	npx biome check src/

lint-fix:
	npx biome check --write src/

clean:
	rm -rf build pr-review dist *.bun-build

release:
	./tools/release.sh
