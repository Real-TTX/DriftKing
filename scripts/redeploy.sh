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

clean=0
whole=0
for arg in "$@"; do
    case "$arg" in
        --clean) clean=1 ;;
        --matgame) whole=1 ;;
    esac
done

if [ "$whole" = 1 ]; then
    if [ "$clean" = 1 ]; then exec sh "$matgame/scripts/redeploy.sh" --clean; fi
    exec sh "$matgame/scripts/redeploy.sh"
fi

cd "$root"
if [ "$clean" = 1 ]; then docker compose -f docker-compose.local.yml down -v --remove-orphans; fi
docker compose -f docker-compose.local.yml build --build-arg "BuildDate=$(date -u +%Y%m%d)" web
docker compose -f docker-compose.local.yml up -d --remove-orphans
echo "DriftKing: http://localhost:2771/driftking/  |  Admin: http://localhost:2771/Admin/DriftKing  |  pgAdmin: http://localhost:2778"
