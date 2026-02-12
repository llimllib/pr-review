.PHONY: lint lint-fix

lint:
	npx biome check src/

lint-fix:
	npx biome check --write src/
