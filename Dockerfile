# Railway deployment image for Altegio → Shopify sync service
FROM node:20-alpine AS base

WORKDIR /app
ENV NODE_ENV=production

# Enable Corepack for Yarn Berry and install dependencies with a reproducible lockfile
RUN corepack enable
# Copy dependency manifests; wildcards avoid build failures if optional Yarn files are absent
COPY package.json yarn.lock* .yarnrc.yml* .yarn/ ./
RUN yarn install --immutable \
  && yarn cache clean

# Copy application source
COPY . .

# Default port used by the app (configurable via PORT env)
EXPOSE 3000

# Start the service
CMD ["yarn", "start"]
