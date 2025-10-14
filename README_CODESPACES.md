# Running the Placement Assessment microservices in GitHub Codespaces

This repo contains three services plus infra: `assessment-api` (Express + Mongo), `judge-service` (worker), and `frontend` (Vite/React). The setup uses Redis and RabbitMQ via Docker Compose.

Quick start (Codespaces / any machine with Docker Compose):

1. Build and start services

```powershell
# from repository root
docker compose up --build
```

2. Services
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MongoDB: mongodb://localhost:27017
- Redis: localhost:6379
- RabbitMQ management UI: http://localhost:15672 (user: user, password: password)

Notes and troubleshooting
- Do NOT commit real credentials to .env. Use the .env files only for local testing and add secrets to Codespaces secret storage.
- If RabbitMQ connection fails, judge-service retries several times.
- The frontend reads API base URL from VITE_API_URL env var (set in docker-compose) or defaults to http://localhost:3000.

If you want, I can:
- Add a Makefile or VS Code tasks.json to simplify running commands.
- Add basic tests for the API and worker.
