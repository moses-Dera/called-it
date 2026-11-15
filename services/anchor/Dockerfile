# Called It anchor service. Runs on any always-on Linux server (a small VPS or Oracle Cloud's free tier).
# The wallet lives in the /data volume; keep it (and back up /data/mnemonic.txt) across upgrades.
FROM node:22-bookworm-slim

WORKDIR /app
# Install first (runs patch-sdk.mjs as postinstall), then copy the service code.
COPY package.json package-lock.json patch-sdk.mjs ./
RUN npm ci --omit=dev && npm cache clean --force
COPY wallet.mjs server.mjs cli.mjs ./

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 ANCHOR_DATA_DIR=/data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
