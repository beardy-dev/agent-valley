#!/bin/sh
set -e

# Applies the current schema.prisma to whatever's on the mounted volume —
# safe to run on every boot since `db push` is a no-op when the schema
# already matches. This stands in for a migration step: Fly's
# release_command runs in a separate ephemeral machine that doesn't get the
# app's volume attached, so it can't reach the SQLite file; doing it here,
# before the server starts, is the straightforward alternative for a
# single-instance app. If it ever reports a destructive change, it exits
# non-zero (no --accept-data-loss) rather than guessing — fix the schema or
# run the push manually with that flag via `fly ssh console`.
npx prisma db push --skip-generate

exec node dist/src/index.js
