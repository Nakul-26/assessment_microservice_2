#!/bin/sh
set -e

# The compose setup mounts a separate node_modules volume. If that volume is
# empty or stale, the app can start with package.json present but runtime
# dependencies missing. Refresh dependencies before boot when needed.
if [ ! -d node_modules/ajv ] || [ ! -d node_modules/ajv-formats ] || [ ! -x node_modules/.bin/nodemon ]; then
  echo "Dependencies missing or stale; running npm ci"
  npm ci
fi

echo "Starting container, executing command: $@"
exec "$@"
