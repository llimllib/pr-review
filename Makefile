.PHONY: lint lint-fix build

lint:
	npx biome check src/

lint-fix:
	npx biome check --write src/

build:
	bun build --compile --outfile=pr-review src/cli.ts
