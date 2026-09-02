# AdCamouflage - developer shortcuts.
# `make help` lists everything.

SHELL := /bin/bash
PY    := .venv/bin/python
PIP   := .venv/bin/pip

.DEFAULT_GOAL := help
.PHONY: help setup backend worker beat frontend test lint build up down logs clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	 | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Create the venv, install backend + frontend dependencies
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements-dev.txt
	cd frontend && npm install

backend: ## Run the API on :8000 with reload
	cd backend && ../$(PY) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker: ## Run a Celery render worker
	cd backend && ../.venv/bin/celery -A app.celery_app.celery_app worker -Q mutations -c 2 --loglevel=info

beat: ## Run the Celery beat scheduler (retention sweeps)
	cd backend && ../.venv/bin/celery -A app.celery_app.celery_app beat --loglevel=info

frontend: ## Run the Next.js dev server on :3000
	cd frontend && npm run dev

test: ## Run the backend test suite
	cd backend && ../$(PY) -m pytest

lint: ## Typecheck and lint the frontend
	cd frontend && npm run typecheck && npm run lint

build: ## Production build of the frontend
	cd frontend && npm run build

up: ## Start the whole stack with Docker Compose
	docker compose up --build -d

down: ## Stop the stack
	docker compose down

logs: ## Tail the stack logs
	docker compose logs -f --tail=100

clean: ## Remove caches and build output
	rm -rf frontend/.next frontend/node_modules/.cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf backend/.pytest_cache
