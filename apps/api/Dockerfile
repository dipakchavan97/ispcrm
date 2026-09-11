FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl for Prisma musl engine
RUN apk add --no-cache openssl

# Copy root workspace configurations and package manifests
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN npm install

# Copy source code and Prisma schema
COPY packages/shared ./packages/shared
COPY packages/database ./packages/database
COPY apps/api ./apps/api

# Build dependencies and API
RUN npm run --workspace=@isp-crm/shared build
RUN npm run --workspace=@isp-crm/database build
RUN npm run --workspace=@isp-crm/api build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Install openssl in runner container
RUN apk add --no-cache openssl wget

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/apps/api ./apps/api

EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
