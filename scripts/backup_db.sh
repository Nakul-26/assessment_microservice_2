#!/bin/bash
# scripts/backup_db.sh
# This script creates a compressed backup of the MongoDB database.
#
# Container name isn't hardcoded: docker-compose.yml (dev) sets an explicit
# "codespace_mongo" name, but docker-compose.prod.yml sets none, so Compose/Dokploy
# auto-generates one that varies by deploy. Resolve it at runtime instead, or pass
# MONGO_CONTAINER_NAME explicitly to skip detection.

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="assessment_db_$TIMESTAMP.gz"

mkdir -p $BACKUP_DIR

CONTAINER_NAME="${MONGO_CONTAINER_NAME:-$(docker ps --filter "name=mongo" --format '{{.Names}}' | head -n1)}"

if [ -z "$CONTAINER_NAME" ]; then
  echo "❌ No running mongo container found. Set MONGO_CONTAINER_NAME explicitly and retry."
  exit 1
fi

echo "Starting backup of assessment_db from container '$CONTAINER_NAME'..."

docker exec "$CONTAINER_NAME" mongodump --db assessment_db --archive --gzip > $BACKUP_DIR/$FILENAME

if [ $? -eq 0 ]; then
  echo "✅ Backup created successfully: $BACKUP_DIR/$FILENAME"
  # Keep only last 7 days of backups
  find $BACKUP_DIR -name "assessment_db_*.gz" -mtime +7 -delete
  echo "Cleaned up old backups."
else
  echo "❌ Backup failed!"
  exit 1
fi
