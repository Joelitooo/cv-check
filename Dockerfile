FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium poppler-utils docx2txt fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY web ./web
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=4321 \
  CHROME_PATH=/usr/bin/chromium \
  CHROME_ARGS="--no-sandbox --disable-dev-shm-usage"
EXPOSE 4321
CMD ["node", "dist/server.js", "--no-open"]
