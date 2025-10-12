#!/bin/sh
set -e

# 1. Set ownership of the application directory to the 'node' user.
# This runs as root successfully because it's the first step in the entrypoint.
echo "Setting runtime ownership of /usr/src/app to 'node' user..."
chown -R node:node /usr/src/app

# 2. Execute the main command using the absolute path to the nodemon binary.
# This bypasses shell PATH resolution conflicts that cause the "Permission denied" error.
echo "Starting application as 'node' user using absolute path..."
exec su node -c "/usr/src/app/node_modules/.bin/nodemon index.js"
