#!/usr/bin/env bash
# Swap the live demo site's layout and push it live.
# Usage: ./deploy.sh v1   (original layout)
#        ./deploy.sh v2   (redesigned layout — breaks naive scrapers on purpose)
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-}"
if [[ "$VERSION" != "v1" && "$VERSION" != "v2" ]]; then
  echo "Usage: $0 <v1|v2>" >&2
  exit 1
fi

cp "layouts/$VERSION.html" index.html
git add index.html
git commit -m "Deploy layout $VERSION" --quiet
git push --quiet
echo "Deployed layout $VERSION."
