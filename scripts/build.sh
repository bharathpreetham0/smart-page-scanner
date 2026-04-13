#!/bin/bash

set -euo pipefail

ENVIRONMENT="${1:-dev}"
OUT_DIR="dist/${ENVIRONMENT}"

case "${ENVIRONMENT}" in
  dev|prod)
    ;;
  *)
    echo "Unsupported environment: ${ENVIRONMENT}"
    exit 1
    ;;
esac

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

cp -R background content popup panel utils styles icons policies "${OUT_DIR}/"
cp "manifest.${ENVIRONMENT}.json" "${OUT_DIR}/manifest.json"
cp README.md "${OUT_DIR}/README.md"

echo "Build complete: ${OUT_DIR}"

