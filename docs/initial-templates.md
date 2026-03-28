# Initial Template Set (V1)

This platform ships with template auto-install metadata for:

## Game Hosting

- `minecraft-paper`
  - Image: `itzg/minecraft-server:latest`
  - Ports: `25565`
  - Auto-env: `EULA=TRUE`, `TYPE=PAPER`
- `cs2`
  - Image: `cm2network/cs2`
  - Ports: `27015`
  - Auto-env: `SRCDS_TOKEN` placeholder

## Python Hosting

- `python-fastapi`
  - Image: `python:3.12-slim`
  - Ports: `8000`
  - Startup: `uvicorn app:app --host 0.0.0.0 --port {{port}}`
- `python-worker`
  - Image: `python:3.12-slim`
  - Ports: none required
  - Startup: `python worker.py`

## Template Behavior

- On create, template is resolved and required ports are allocated
- Install status starts at `installing` and transitions to `running`
- Reinstall keeps server identity and reallocates missing ports
