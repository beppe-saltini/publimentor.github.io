#!/usr/bin/env bash
# =============================================================================
# Database Backup Script
# =============================================================================
# Automated PostgreSQL backup with retention management.
#
# Usage:
#   ./backup-database.sh                  # Backup using DATABASE_URL
#   BACKUP_DIR=/backups ./backup-database.sh  # Custom backup directory
#
# Schedule via cron:
#   0 2 * * * /path/to/backup-database.sh >> /var/log/db-backup.log 2>&1
# =============================================================================

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/publimentor_${TIMESTAMP}.sql.gz"

# Parse DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[BACKUP] ERROR: DATABASE_URL not set"
  exit 1
fi

# Extract connection details from DATABASE_URL
# Format: postgresql://user:password@host:port/dbname
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

echo "[BACKUP] Starting database backup..."
echo "[BACKUP] Database: ${DB_NAME}@${DB_HOST}:${DB_PORT}"
echo "[BACKUP] Target: ${BACKUP_FILE}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Perform backup
export PGPASSWORD="$DB_PASS"
pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=plain \
  --no-owner \
  --no-acl \
  --verbose 2>/dev/null | gzip > "$BACKUP_FILE"

# Verify backup
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[BACKUP] Success! Backup size: ${SIZE}"
else
  echo "[BACKUP] ERROR: Backup file is empty or missing"
  exit 1
fi

# Cleanup old backups
if [ "$RETENTION_DAYS" -gt 0 ]; then
  DELETED=$(find "$BACKUP_DIR" -name "publimentor_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
  if [ "$DELETED" -gt 0 ]; then
    echo "[BACKUP] Cleaned up ${DELETED} old backup(s) (older than ${RETENTION_DAYS} days)"
  fi
fi

echo "[BACKUP] Backup complete: ${BACKUP_FILE}"
