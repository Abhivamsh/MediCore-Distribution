FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies layer (cached unless package.json changes)
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source
COPY src/ ./src/

# Non-root user for security
RUN addgroup -S medicore && adduser -S medicore -G medicore
USER medicore

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
