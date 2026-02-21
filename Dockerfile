# Playwright image už obsahuje všechny systémové závislosti pro Chromium
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci

# Copy app
COPY . .

# Render nastavuje PORT automaticky
ENV NODE_ENV=production

# Spuštění
CMD ["node", "server.js"]
