#!/bin/sh

# This script runs before the main application command (npm run dev).

# Check if the working directory (/usr/src/app) exists and is not empty.
# Since we are using volume mounts, this directory contains the code from the host.
# We explicitly change the ownership of the mounted files to the container's 
# non-root 'node' user to prevent "Permission denied" errors on execution.
if [ -d /usr/src/app ]; then
    echo "Setting ownership of mounted files to 'node' user..."
    chown -R node:node /usr/src/app
fi

# Execute the main command passed to the container (i.e., npm run dev)
exec "$@"
