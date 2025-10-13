#!/bin/sh
set -e

# Minimal entrypoint: do not attempt to change ownership here because
# the container is typically switched to the non-root 'node' user in the Dockerfile.
# Just exec the command given by the image (CMD) so portability is preserved.
echo "Starting container, executing command: $@"
exec "$@"
