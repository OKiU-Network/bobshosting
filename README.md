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

- **Auto `PUBLIC_API_URL`:** prefers **private/LAN** IPv4 (`10.x`, `192.168.x`, `172.16–31.x`), not your WAN. For WAN-only hosts use **`WAVE_USE_WAN_FOR_PUBLIC_API=1`**, or set **`PUBLIC_API_URL`** (e.g. `http://192.168.1.10:4000`). You are asked: **Customize secrets and `PUBLIC_API_URL` now?** Answer **N** (or Enter) for auto secrets + auto-detect. Answer **y** to type `JWT_SECRET`, `POSTGRES_PASSWORD`, and/or `PUBLIC_API_URL` (blank fields get random or auto-detect).
- **Changing the API URL later:** edit or remove `infra/.env.deploy` and re-run `scripts/ubuntu-first-install.sh` so the web image rebuilds with the new `NEXT_PUBLIC` API base.
- **Private repo:** GitHub raw URLs need auth — clone with a **deploy key** or **PAT** to e.g. `/opt/wave-hosting`, then:

```bash
cd /opt/wave-hosting && sudo bash scripts/bootstrap.sh
```

- **No prompts** (CI / cloud-init): `export WAVE_NONINTERACTIVE=1` before running `bootstrap.sh`.
- **Git “diverged” (e.g. after a force-push):** when bootstrap updates **`/opt/wave-hosting`**, it **defaults** to **`git reset --hard origin/main`** so the deploy tree matches GitHub. Set **`WAVE_GIT_NO_AUTO_RESET=1`** only if you must keep server-only commits there; then use **`WAVE_GIT_RESET=1`** or reset manually when you want to align with GitHub.
- After bootstrap, the same machine can be re-run with `sudo bash scripts/ubuntu-first-install.sh` (see `scripts/ubuntu-first-install.sh` for rebuild behavior).

**Compose: `dependency failed to start: … api … unhealthy`**

1. Inspect the API process: `docker logs wavehosting-api-1` (or `docker compose -p wavehosting --env-file infra/.env.deploy -f infra/docker-compose.yml logs api`).
2. **Corrupt panel data:** the API reads `store.json` from the `wave_api_data` volume (`apps/api/.data` in the container). Invalid JSON or a wrong shape can prevent startup; the API now falls back to seed defaults and logs a warning, but if an older image crashed earlier, upgrade the image and restart, or remove the bad file by attaching to the volume and deleting `store.json`, then `docker compose … up -d` again.
3. Confirm the health URL from the host: `curl -sS http://127.0.0.1:4000/v1/health` (expect JSON with `isSuccess`).

## Attribution, inspiration, and legal

### Relationship to Pterodactyl (and similar panels)

This repository is an **independent** hosting stack. It targets a **similar** problem space to panels such as [**Pterodactyl**](https://github.com/pterodactyl/panel) (remote nodes, game servers, install templates, operator-facing UI). It is **not** a fork or official derivative of Pterodactyl Panel, is **not** affiliated with, endorsed by, or maintained by the Pterodactyl project or its contributors, and must not be marketed as “Pterodactyl” or implied official compatibility unless you document and implement that yourself.

Optional tooling: `npm run fetch:eggs` runs `scripts/fetch-pterodactyl-eggs.mjs`, which **downloads stock egg definitions** from the public `pterodactyl/panel` Git tree for **import/conversion** into Wave’s own template format. That upstream content remains under [**Pterodactyl Panel’s license**](https://github.com/pterodactyl/panel/blob/develop/LICENSE.md) (MIT as of common releases—verify the branch you fetch). You are responsible for complying with upstream terms when you redistribute or ship derived data.

### What we actually built on

- **Application stack**: TypeScript, Node.js, **Next.js** (App Router), **Fastify**, **Docker** / Compose, **PostgreSQL**, **nginx** (see `infra/`), shell bootstrap for **Ubuntu** LTS.
- **Design**: Original API, web panel, agents, and data models unless individual files state otherwise; parallels to “panel + daemon + eggs” are **conceptual**, not a code copy of Pterodactyl’s Panel or Wings.

### AI-assisted development

A large share of this codebase was **produced or reshaped using AI coding assistants** (e.g. integrated editor tools and large language models) **under human review and direction**. That does not remove the need for your own **security review**, **compliance** checks, and **testing** before production. Operators remain responsible for deployment, data protection, and any customer-facing claims.

### Legal (short disclaimer)

- **Trademarks**: Names such as *Pterodactyl*, *Docker*, *Ubuntu*, *Next.js*, *GitHub*, and others are **trademarks** of their respective owners. This project is not sponsored by them.
- **No warranty**: Software is provided **“as is”**, without warranty of any kind. For redistribution and modification terms, follow the **`LICENSE`** file in this repository when one is published (the root `package.json` is currently `private`; add an explicit license before external distribution if needed).
- **Not legal advice**: This section is for transparency and orientation only, not a substitute for professional legal counsel.
