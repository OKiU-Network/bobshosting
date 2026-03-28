# Wave Hosting Platform (Internal Prep)

Internal-first hosting platform for game servers and Python runtimes.

## Workspace

- `apps/web`: Next.js 14 dashboard panel
- `apps/api`: Fastify API and scheduler
- `apps/cli`: Operator CLI
- `apps/node-agent`: Docker node agent (remote host)
- `packages/shared`: Shared interfaces and helpers
- `infra`: Docker and deployment templates
- `docs`: Product and operations docs

## Local Development (Windows, no local Docker)

1. Install Node.js 20+
2. Run `npm install`
3. Copy `.env.example` to `.env` and update values
4. Start API: `npm run dev:api`
5. Start web: `npm run dev:web`
6. Run CLI: `npm run dev:cli -- --help`

Node runtime operations are designed to execute against a remote Linux host running Docker and the node agent.

## Internal Scope

- Auth and RBAC skeleton
- Server lifecycle API
- Networking/port allocation API
- File manager API contract
- Webshop hooks
- Template auto-provisioning model
- CLI commands for server operations

## Customer-Later Checklist

See `docs/customer-hardening-checklist.md`.
