# Single image: nginx (8080) → Next.js (3000) + API (4000) + node-agent (7001)
# Build from repository root:
#   docker build -f infra/all-in-one/Dockerfile -t wave-hosting:all-in-one .
#
# Browser uses same origin for API: set NEXT_PUBLIC_API_BASE_URL empty at build time.
# Mount Docker socket for game containers, and persist API store + server data.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/node-agent/package.json ./apps/node-agent/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY apps/node-agent ./apps/node-agent

ENV NEXT_PUBLIC_API_BASE_URL=
RUN npm run build -w @wave/api && npm run build -w @wave/web && npm run build -w @wave/node-agent

FROM node:20-alpine AS runner
RUN apk add --no-cache nginx supervisor

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/next.config.mjs

COPY --from=builder /app/apps/node-agent/dist ./apps/node-agent/dist
COPY --from=builder /app/apps/node-agent/package.json ./apps/node-agent/package.json

COPY infra/all-in-one/nginx.conf /etc/nginx/http.d/default.conf
RUN rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true
COPY infra/all-in-one/supervisord.conf /etc/supervisord.conf

RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=4000
ENV AGENT_PORT=7001
ENV REMOTE_AGENT_URL=http://127.0.0.1:7001
ENV JWT_SECRET=change-me

EXPOSE 8080 7001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
