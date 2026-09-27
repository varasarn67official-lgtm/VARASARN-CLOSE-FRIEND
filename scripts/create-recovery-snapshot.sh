#!/usr/bin/env bash
set -euo pipefail
name="recovery-$(date -u +%Y%m%dT%H%M%SZ)"
neon snapshots create --branch production --name "$name"
echo "Created Neon recovery snapshot: $name"
