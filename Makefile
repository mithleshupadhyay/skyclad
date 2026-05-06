.DEFAULT_GOAL := help

.PHONY: help install dev start build lint test audit verify clean reset-db docker-build docker-up docker-down docker-logs

help:
	@printf "Available targets:\n"
	@printf "  make install       Install npm dependencies\n"
	@printf "  make dev           Start local TypeScript server\n"
	@printf "  make start         Start compiled server\n"
	@printf "  make build         Compile TypeScript\n"
	@printf "  make lint          Run TypeScript strict check\n"
	@printf "  make test          Run unit and integration tests\n"
	@printf "  make audit         Run npm audit\n"
	@printf "  make verify        Run lint, build, tests, and audit\n"
	@printf "  make reset-db      Remove local SQLite database files\n"
	@printf "  make docker-build  Build Docker image\n"
	@printf "  make docker-up     Start Docker Compose service\n"
	@printf "  make docker-down   Stop Docker Compose service\n"
	@printf "  make docker-logs   Tail Docker Compose logs\n"

install:
	npm install

dev:
	npm run dev

start:
	npm start

build:
	npm run build

lint:
	npm run lint

test:
	npm test

audit:
	npm audit --omit=optional

verify:
	npm run lint
	npm run build
	npm test
	npm audit --omit=optional

clean:
	rm -rf dist coverage

reset-db:
	rm -f data/skyclad-gateway.db data/skyclad-gateway.db-shm data/skyclad-gateway.db-wal

docker-build:
	docker build -t skyclad-llm-gateway .

docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f gateway

