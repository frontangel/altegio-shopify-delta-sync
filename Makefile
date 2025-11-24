# ---- Redis Infra Commands ----

infra-up:
	docker compose -f docker-compose.yml up -d

infra-down:
	docker compose -f docker-compose.yml down

infra-logs:
	docker compose -f docker-compose.yml logs -f redis

infra-restart:
	docker compose -f docker-compose.yml down
	docker compose -f docker-compose.yml up -d
