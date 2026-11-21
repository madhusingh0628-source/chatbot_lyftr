.PHONY: up down logs test

up:      ## build and start backend (:8000) and frontend (:3000)
	docker compose up -d --build
	@echo "backend:  http://localhost:8000/health"
	@echo "frontend: http://localhost:3000"

down:    ## stop everything (the SQLite volume is kept)
	docker compose down

logs:
	docker compose logs -f

test:    ## run backend tests locally
	cd backend && pip install -q -r requirements-dev.txt && python -m pytest -q
