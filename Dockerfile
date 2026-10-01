# ZAPIT — Production Dockerfile (Phase 5)
# Multi-stage, slim, non-root, healthcheck
FROM node:22-alpine AS base   # supabase-js' realtime client requires Node >= 22 (built-in WebSocket)
WORKDIR /app

# Install deps separately for layer cache
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts || npm install --only=production --ignore-scripts

# Copy source
COPY index.js ./
COPY src ./src
COPY public ./public
COPY supabase ./supabase
COPY scripts ./scripts
COPY dashboard.html index.html login.html pricing.html ./

# Non-root user
RUN addgroup -S zapit && adduser -S zapit -G zapit && chown -R zapit:zapit /app
USER zapit

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
