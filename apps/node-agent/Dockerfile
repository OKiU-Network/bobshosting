FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY apps/node-agent/package.json ./apps/node-agent/package.json
RUN npm install

COPY apps/node-agent ./apps/node-agent
WORKDIR /app/apps/node-agent
RUN npm run build

EXPOSE 7001
CMD ["npm", "run", "start"]
