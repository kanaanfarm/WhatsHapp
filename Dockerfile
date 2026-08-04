FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -r /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=node:node telegram.js ./
COPY --chown=node:node public ./public

USER node

# AI Provider Configuration
ENV AI_PROVIDER=hybrid
ENV OPENAI_API_KEY=""
ENV DEEPSEEK_API_KEY=""
ENV OLLAMA_URL=""
ENV OLLAMA_MODEL=qwen2.5:7b

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.ok ? process.exit(0) : process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "telegram.js"]
