#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

./scripts/build.sh prod

VERSION="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' manifest.prod.json | head -n 1)"
ARCHIVE_NAME="smart-page-scanner-v${VERSION}.zip"

rm -f "${ARCHIVE_NAME}"
cd dist/prod
zip -rq "../../${ARCHIVE_NAME}" .
cd "${ROOT_DIR}"

echo "Packaged ${ARCHIVE_NAME}"

