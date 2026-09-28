FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2

ENV NODE_ENV=production \
    HT_HOST=0.0.0.0 \
    HT_PORT=8787 \
    HT_DATA_DIR=/data

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node schemas ./schemas
COPY --chown=node:node LICENSE README.md ./

USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.HT_PORT || '8787') + '/api/health', { headers: { 'x-harness-tavern-token': process.env.HT_ACCESS_TOKEN || '' } }).then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "src/main.js", "serve"]
