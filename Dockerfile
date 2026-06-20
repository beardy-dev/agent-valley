# Single-stage build: the `prisma` CLI (a devDependency) needs to stay in the
# final image so docker-entrypoint.sh can run `prisma db push` against the
# mounted volume on every boot — see that file for why this app applies its
# schema at startup instead of via a Fly release_command (release_command
# machines don't get the app's volume attached).
FROM node:20-bookworm-slim

WORKDIR /app

# Prisma's query engine binary is dynamically linked against OpenSSL; the
# slim base image doesn't include it.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY bot ./bot
RUN npx prisma generate && npm run build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
