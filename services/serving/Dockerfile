# Build context is the REPO ROOT (see docker-compose.yml), not this directory,
# because the image needs prompts/ from the root. Prompts are behaviour, not
# documentation: the agent reads them at runtime, so they ship with the image.
FROM node:22-alpine AS build
WORKDIR /app
COPY services/serving/package.json ./
RUN npm install
COPY services/serving/tsconfig.json ./
COPY services/serving/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PROMPTS_DIR=/app/prompts
COPY services/serving/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# Migrations are read at runtime by the runner, so they ship alongside dist.
COPY services/serving/src/db/migrations ./dist/db/migrations
COPY prompts ./prompts
EXPOSE 3000
# Migrate, then serve. `&&` means the server never starts against a schema that is
# behind. `exec` hands PID 1 to node, so node receives SIGTERM directly on shutdown.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
