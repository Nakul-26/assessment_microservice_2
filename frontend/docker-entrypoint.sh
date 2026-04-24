#!/bin/sh
set -e

# The compose setup mounts a separate node_modules volume. If that volume is
# empty or stale, install dependencies from the lockfile before starting Vite.
if [ ! -x node_modules/.bin/vite ] || [ ! -d node_modules/react ] || [ ! -d node_modules/react-dom ]; then
  echo "Frontend dependencies missing or stale; running npm ci"
  npm ci
fi

echo "Starting frontend, executing command: $@"
exec "$@"
