#!/usr/bin/env bash
# Deploys Open Eye to the linked Railway project (production environment).
#
#   scripts/deploy-railway.sh            # web + worker
#   scripts/deploy-railway.sh web        # web only
#   scripts/deploy-railway.sh worker     # worker only
#
# The services are not connected to GitHub, so pushing does not deploy; this uploads local code.
# The worker is uploaded from a staging directory containing only Dockerfile.worker and apps/worker:
# uploading the repo root would apply the root railway.json (the web app's build/start config) to it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"

PROJECT_ID="${RAILWAY_PROJECT_ID:-$(cd "$ROOT" && railway status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')}"

deploy_web() {
  echo "==> Deploying web"
  (cd "$ROOT" && railway up --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service web --ci)
}

deploy_worker() {
  echo "==> Deploying worker"
  local stage
  stage="$(mktemp -d)"
  mkdir -p "$stage/apps"
  rsync -a --exclude venv --exclude __pycache__ --exclude '*.pyc' "$ROOT/apps/worker" "$stage/apps/"
  cp "$ROOT/Dockerfile.worker" "$stage/Dockerfile.worker"
  # `railway up` must run from inside the directory it uploads
  (cd "$stage" && railway up --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service worker --ci)
  rm -rf "$stage"
}

case "$TARGET" in
  web) deploy_web ;;
  worker) deploy_worker ;;
  all) deploy_web; deploy_worker ;;
  *) echo "Usage: $0 [web|worker|all]" >&2; exit 2 ;;
esac
