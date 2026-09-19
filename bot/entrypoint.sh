#!/bin/sh
set -e

echo "🚀 Starting Lavamusic container..."

bun add @libsql/client 2>/dev/null || true

if echo "$DATABASE_URL" | grep -qE "^sqlite:|file:.*\.db$|file:.*\.sqlite$|\.db$|\.sqlite$"; then
  echo "📂 SQLite database — running migrations..."
  bun run db:push:sqlite
else
  echo "🐘 PostgreSQL/PGLite — running migrations..."
  bun run db:push
fi

echo "✅ Database ready"
exec "$@"
