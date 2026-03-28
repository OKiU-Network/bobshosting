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

## Ubuntu server (one-liner bootstrap)

Upstream repo: [OKiU-Network/bobshosting](https://github.com/OKiU-Network/bobshosting). The repo must be **public** for the raw `curl` URL to work (or clone privately and run `bootstrap.sh` from disk).

```bash
export WAVE_REPO_URL=https://github.com/OKiU-Network/bobshosting.git
curl -fsSL https://raw.githubusercontent.com/OKiU-Network/bobshosting/main/scripts/bootstrap.sh | sudo -E bash
```

If **`curl` returns 404**, the file is not at that path: confirm the default branch on GitHub is **`main`** (Settings → General), or change the URL to `.../master/...` (or your branch name). **Private** repos return 404 for `raw.githubusercontent.com` without a token — clone with a deploy key, then run `sudo bash scripts/bootstrap.sh` from the clone.

If the installer prints **`set: pipefail: invalid option`**, scripts were saved with **Windows CRLF**. On the server run `sed -i 's/\r$//' scripts/*.sh`, or `git pull` after our `.gitattributes` fix and reset line endings.

- You are asked: **Customize secrets and `PUBLIC_API_URL` now?** Answer **N** (or Enter) to use **auto-generated secrets** and **auto-detected** `PUBLIC_API_URL`. Answer **y** to type `JWT_SECRET`, `POSTGRES_PASSWORD`, and/or `PUBLIC_API_URL` (blank fields get random or auto-detect).
- **Private repo:** GitHub raw URLs need auth — clone with a **deploy key** or **PAT** to e.g. `/opt/wave-hosting`, then:

```bash
cd /opt/wave-hosting && sudo bash scripts/bootstrap.sh
```

- **No prompts** (CI / cloud-init): `export WAVE_NONINTERACTIVE=1` before running `bootstrap.sh`.
- After bootstrap, the same machine can be re-run with `sudo bash scripts/ubuntu-first-install.sh` (see `scripts/ubuntu-first-install.sh` for rebuild behavior).
