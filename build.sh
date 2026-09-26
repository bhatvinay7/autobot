#!/usr/bin/env bash
# build.sh — Sequentially build Docker images for all apps in the monorepo.
# Usage:  ./build.sh [--tag-prefix <prefix>] [--app <name>]
#   --tag-prefix  Image tag prefix (default: "automate")
#   --app         Build only one app: bot | dashboard | ingestion

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────────
APPS=("bot" "dashboard" "ingestion")
TAG_PREFIX="automate"
ONLY_APP=""

# ─── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag-prefix) TAG_PREFIX="$2"; shift 2 ;;
    --app)        ONLY_APP="$2";   shift 2 ;;
    -h|--help)
      sed -n '2,4p' "$0"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -n "$ONLY_APP" ]]; then
  APPS=("$ONLY_APP")
fi

# ─── Helpers ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'
BOLD='\033[1m'

log()    { echo -e "${CYAN}[build]${RESET} $*"; }
success(){ echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()   { echo -e "${YELLOW}[!]${RESET} $*"; }
fail()   { echo -e "${RED}${BOLD}[✗]${RESET} $*"; }

# ─── Pre-flight ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  fail "docker not found. Please install Docker."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   Monorepo Sequential Docker Builder     ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# Track results
declare -A RESULTS
FAILED=0
START_ALL=$(date +%s)

# ─── Build loop ────────────────────────────────────────────────────────────────
for APP in "${APPS[@]}"; do
  DOCKERFILE="$SCRIPT_DIR/apps/$APP/Dockerfile"
  IMAGE="${TAG_PREFIX}/${APP}:latest"

  echo ""
  echo -e "${BOLD}──────────────────────────────────────────${RESET}"
  log "Building ${BOLD}${APP}${RESET} → ${IMAGE}"
  echo -e "${BOLD}──────────────────────────────────────────${RESET}"

  if [[ ! -f "$DOCKERFILE" ]]; then
    warn "Dockerfile not found at $DOCKERFILE — skipping $APP"
    RESULTS[$APP]="SKIPPED"
    continue
  fi

  START=$(date +%s)

  # Run docker build from monorepo root so turbo prune context is correct
  if docker build \
      --file "$DOCKERFILE" \
      --tag  "$IMAGE" \
      "$SCRIPT_DIR"; then
    END=$(date +%s)
    ELAPSED=$(( END - START ))
    success "Built ${BOLD}${APP}${RESET} in ${ELAPSED}s  →  ${IMAGE}"
    RESULTS[$APP]="OK (${ELAPSED}s)"
  else
    END=$(date +%s)
    ELAPSED=$(( END - START ))
    fail "Failed to build ${BOLD}${APP}${RESET} after ${ELAPSED}s"
    RESULTS[$APP]="FAILED"
    FAILED=$(( FAILED + 1 ))
    # Ask whether to keep going or abort
    if [[ "${CONTINUE_ON_ERROR:-}" != "1" ]]; then
      echo ""
      warn "Set CONTINUE_ON_ERROR=1 to keep building other apps on failure."
      break
    fi
  fi
done

# ─── Summary ───────────────────────────────────────────────────────────────────
END_ALL=$(date +%s)
TOTAL=$(( END_ALL - START_ALL ))

echo ""
echo -e "${BOLD}══════════════════ Build Summary ══════════════════${RESET}"
printf "  %-14s  %s\n" "APP" "RESULT"
echo -e "  ──────────────────────────────────────────────"
for APP in "${APPS[@]}"; do
  STATUS="${RESULTS[$APP]:-NOT RUN}"
  if [[ "$STATUS" == FAILED ]]; then
    printf "  ${RED}%-14s  %s${RESET}\n" "$APP" "$STATUS"
  elif [[ "$STATUS" == SKIPPED ]]; then
    printf "  ${YELLOW}%-14s  %s${RESET}\n" "$APP" "$STATUS"
  else
    printf "  ${GREEN}%-14s  %s${RESET}\n" "$APP" "$STATUS"
  fi
done
echo -e "  ──────────────────────────────────────────────"
echo -e "  Total time: ${TOTAL}s"
echo ""

if [[ $FAILED -gt 0 ]]; then
  fail "${FAILED} build(s) failed."
  exit 1
else
  success "All builds completed successfully!"
  exit 0
fi
