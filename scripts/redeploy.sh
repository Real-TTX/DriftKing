#!/usr/bin/env sh
# Rebuilds and starts DriftKing locally: its own stack (MatGame host with only DriftKing, port 2771, pgAdmin 2778, Postgres 2780),
# or with --matgame the whole MatGame stack with every game (port 2770). ../MatGame has to sit next to this repository.
# Usage: ./scripts/redeploy.sh [--clean] [--matgame]
set -e
here=$(cd "$(dirname "$0")" && pwd)
root="$here/.."
matgame="$root/../MatGame"
if [ ! -d "$matgame" ]; then
    echo "MatGame fehlt: DriftKing laeuft als Plugin von MatGame. Bitte https://github.com/Real-TTX/MatGame neben dieses Repository klonen." >&2
    exit 1
fi

clean=""
for arg in "$@"; do
    case "$arg" in
        --clean) clean=1 ;;
        --matgame) exec sh "$matgame/scripts/redeploy.sh" ${clean:+--clean} ;;
    esac
done

cd "$root"
if [ -n "$clean" ]; then docker compose -f docker-compose.local.yml down -v; fi
docker compose -f docker-compose.local.yml up -d --build
echo "DriftKing: http://localhost:2771/driftking/  ·  Admin: http://localhost:2771/Admin/DriftKing  ·  pgAdmin: http://localhost:2778"
