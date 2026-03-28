# Windows Dev Runbook (No Local Docker)

## Prerequisites

- Windows with Node.js 20+
- A remote Linux host with Docker for node agent runtime testing

## Steps

1. `npm install`
2. Copy `env.example` to `.env` and set:
   - `REMOTE_AGENT_URL` to remote Linux node agent URL
   - `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`
3. Start API: `npm run dev:api`
4. Start web: `npm run dev:web`
5. Start CLI command: `npm run dev:cli -- servers:list` (with `API_TOKEN` set)

## Remote Node Agent

On Linux host:

1. Deploy `apps/node-agent` (node process or Docker container)
2. Expose `7001` over private network/VPN
3. Set env:
   - `RUNTIME_DRIVER=process` for Windows/no-Docker testing
   - use `RUNTIME_DRIVER=docker` on Linux Docker hosts
   - `DOCKER_SOCKET_PATH=/var/run/docker.sock` (docker mode only)
   - `SERVER_DATA_ROOT=/var/lib/wave-hosting/servers`
4. Verify `GET /health` returns success

## Validation Flow

1. Login in panel with `admin@local.dev` / `admin123`
2. Create server using a template
3. Confirm allocated ports appear in server list
4. Run stop/start/restart from panel
5. Call webshop endpoint `POST /v1/orders/provision`

## Notes

- Local Windows machine does not need Docker for control-plane development
- Runtime provisioning is real Docker Engine provisioning, not simulated records
- Production deployment stays Docker-ready via `infra/docker-compose.yml`
