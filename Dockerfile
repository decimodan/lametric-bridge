# Node 22.12+ matches engines in package.json (same pin as sentinel).
FROM node:22.12-alpine

WORKDIR /app

ENV NODE_ENV=production \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.BRIDGE_PORT||process.env.PORT||'8787'; fetch('http://127.0.0.1:'+p+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/server.ts"]
