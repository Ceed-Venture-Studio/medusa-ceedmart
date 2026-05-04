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

# Convert the .env file into a YAML file Cloud Run consumes via --env-vars-file.
# We tried --set-env-vars with the ^@^ delimiter but values like DATABASE_URL
# (contains "@") and STORE_CORS (contains ",") collided with both the default
# and custom delimiters. YAML sidesteps quoting entirely.
ENV_YAML="$(mktemp -t cloudrun-env.XXXXXX.yaml)"
trap 'rm -f "$ENV_YAML"' EXIT

build_env_yaml() {
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value%\"}"; value="${value#\"}"
    # Escape single quotes by doubling them, then wrap value in single quotes.
    # Any byte is legal inside YAML single-quoted strings except a bare single
    # quote, so escaping that one character is enough.
    local escaped="${value//\'/\'\'}"
    printf "%s: '%s'\n" "$key" "$escaped"
  done < "$ENV_FILE"
}

build_env_yaml > "$ENV_YAML"

if [[ -z "${SKIP_API:-}" ]]; then
  echo ">>> Deploying $API_SERVICE (image: api:$IMAGE_TAG)"
  # --no-cpu-throttling: keep CPU allocated outside HTTP requests so async
  # workflows (e.g. process-import-chunks during a bulk product upload) can
  # progress between the 202 confirm response and the next inbound request.
  # Without this, large imports stall until something else hits the API.
  gcloud run deploy "$API_SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --image="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/api:${IMAGE_TAG}" \
    --port=9000 \
    --min-instances=1 --max-instances=1 \
    --cpu=1 --memory=2Gi \
    --timeout=600 \
    --no-cpu-throttling \
    --allow-unauthenticated \
    --env-vars-file="$ENV_YAML"
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
