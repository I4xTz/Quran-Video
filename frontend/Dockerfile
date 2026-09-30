FROM node:20-bookworm-slim AS base

WORKDIR /app

# Install dependencies and Remotion requirements for Debian
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libfreetype6 \
    libharfbuzz0b \
    libgbm1 \
    libdrm2 \
    libasound2 \
    libatk-bridge2.0-0 \
    libxshmfence1 \
    ca-certificates \
    fonts-freefont-ttf \
    ffmpeg \
    mesa-utils \
    libgl1-mesa-dri \
    libcairo2 \
    libpango1.0-0 \
    fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

COPY fonts-local.conf /etc/fonts/local.conf

COPY package.json package-lock.json* ./
# Copy prisma schema before npm install so the postinstall `prisma generate` succeeds
COPY prisma ./prisma
RUN npm install

# We copy the rest of the files, although we will mount them using volumes in docker-compose
COPY . .

EXPOSE 3000

# Production image (docker-compose.prod.yml builds this target): a real
# optimized build served by `next start`. src/ stays in the image on
# purpose -- render/route.ts bundles src/remotion at runtime.
FROM base AS production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
CMD ["npm", "start"]

# Development image -- last stage, so a plain `docker compose up` keeps
# building this one. Run development server to enable hot-reload
FROM base AS dev
CMD ["npm", "run", "dev"]
