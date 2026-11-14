# ScrapMan — one container for the static PWA and the verify-collector Node API.
#
# The cPanel deployment split these: Apache served the static site and the Node app answered
# only /verify-collector/*. Here a single process does both (see serveStatic in
# verify-collector/server.js), because AppJet hosting runs one container and one port.
#
# Base image: node:26-alpine (current LTS, satisfies engines: ">=22"). Alpine keeps the
# final image free of the glibc findings that Debian-based tags carry.
FROM node:26-alpine AS deps
RUN echo "os-refresh 2026-11-14" && apk upgrade --no-cache
WORKDIR /app/verify-collector
COPY verify-collector/package.json verify-collector/package-lock.json ./
RUN npm ci --omit=dev

FROM node:26-alpine
RUN echo "os-refresh 2026-11-14" && apk upgrade --no-cache
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Runtime dependencies only — the static site has no build step and the root devDependencies
# (eslint, typescript) are not needed to serve it.
COPY --from=deps /app/verify-collector/node_modules ./verify-collector/node_modules
COPY . .

# Non-root. The app only reads its files and holds no writable state of its own.
USER node
EXPOSE 3000
CMD ["node", "verify-collector/server.js"]
