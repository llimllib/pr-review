.PHONY: lint lint-fix clean release

SOURCES := $(wildcard src/*.ts)

pr-review: build/cli.js
	bun build --compile --outfile=pr-review build/cli.js

build/cli.js: $(SOURCES) build.ts
	bun run build.ts

lint:
	npx biome check src/

lint-fix:
	npx biome check --write src/

clean:
	rm -rf build pr-review dist

release:
	./tools/release.sh
