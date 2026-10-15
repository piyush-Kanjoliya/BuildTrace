# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# BuildTrace backend - Node/Express API + Socket.IO server
# ---------------------------------------------------------------------------
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so the layer cache survives source edits
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source, plus the demo seeder (it runs through the real
# models/services, so nothing extra is required at runtime)
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node
EXPOSE 5000

# BusyBox wget is part of the alpine base image
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health || exit 1

CMD ["node", "server.js"]
