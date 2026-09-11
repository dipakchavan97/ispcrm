FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace configurations and package manifests
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN npm install

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build shared and web
RUN npm run --workspace=@isp-crm/shared build
RUN npm run --workspace=@isp-crm/web build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/web ./apps/web

EXPOSE 3000

CMD ["npm", "run", "--workspace=@isp-crm/web", "start"]
