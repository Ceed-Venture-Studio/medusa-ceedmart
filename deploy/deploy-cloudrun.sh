#!/usr/bin/env bash
# Deploy ceedmart API + Admin to Cloud Run with env vars from app/ceedmart/.env.production.
#
# Usage:
#   ./deploy/deploy-cloudrun.sh                   # deploys :latest (both services)
#   IMAGE_TAG=abc1234 ./deploy/deploy-cloudrun.sh # specific tag
#   SKIP_ADMIN=1 ./deploy/deploy-cloudrun.sh      # API only
#   SKIP_API=1 ./deploy/deploy-cloudrun.sh        # Admin only
#
# Prereqs:
#   - gcloud auth (project=ceedmart, user=ceedrealty@gmail.com)
#   - cloudbuild.yaml has built and pushed images to Artifact Registry
#   - app/ceedmart/.env.production is filled in (DATABASE_URL, REDIS_URL especially)
set -euo pipefail

PROJECT="${PROJECT:-ceedmart}"
REGION="${REGION:-europe-west1}"
REPO="${REPO:-ceedmart-docker}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../app/ceedmart/.env.production}"

API_SERVICE="${API_SERVICE:-ceedmart-api}"
ADMIN_SERVICE="${ADMIN_SERVICE:-ceedmart-admin}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

# Build the comma-separated KEY=VAL list for --set-env-vars from the env file.
# Skips blank lines and comments. Values with commas use the ^@^ delimiter trick.
build_env_args() {
  local pairs=()
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # Strip surrounding quotes if any
    value="${value%\"}"; value="${value#\"}"
    pairs+=("${key}=${value}")
  done < "$ENV_FILE"
  # Use ^@^ as delimiter so values can contain commas
  local IFS='@'
  echo "^@^${pairs[*]}"
}

ENV_ARGS=$(build_env_args)

if [[ -z "${SKIP_API:-}" ]]; then
  echo ">>> Deploying $API_SERVICE (image: api:$IMAGE_TAG)"
  gcloud run deploy "$API_SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --image="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/api:${IMAGE_TAG}" \
    --port=9000 \
    --min-instances=1 --max-instances=1 \
    --cpu=1 --memory=2Gi \
    --timeout=600 \
    --allow-unauthenticated \
    --set-env-vars="$ENV_ARGS"
fi

if [[ -z "${SKIP_ADMIN:-}" ]]; then
  echo ">>> Deploying $ADMIN_SERVICE (image: admin:$IMAGE_TAG)"
  gcloud run deploy "$ADMIN_SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --image="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/admin:${IMAGE_TAG}" \
    --port=8080 \
    --min-instances=0 --max-instances=3 \
    --cpu=1 --memory=512Mi \
    --allow-unauthenticated
fi

echo ">>> Done."
