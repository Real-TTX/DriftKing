#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Rebuilds and starts DriftKing locally: its own stack (MatGame host with only DriftKing, port 2771, pgAdmin 2778, Postgres 2780),
    or with -MatGame the whole MatGame stack with every game (port 2770, ../MatGame/scripts/redeploy.ps1).
.DESCRIPTION
    DriftKing is a plugin of MatGame: ../MatGame has to sit next to this repository (the Docker build takes it as the named context "matgame").
    -Clean removes the volumes first (empty database).
.EXAMPLE
    ./scripts/redeploy.ps1
.EXAMPLE
    ./scripts/redeploy.ps1 -Clean
.EXAMPLE
    ./scripts/redeploy.ps1 -MatGame
#>
param([switch]$Clean, [switch]$MatGame)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$matgameRoot = Join-Path (Split-Path -Parent $root) 'MatGame'
if (-not (Test-Path $matgameRoot)) {
    throw "MatGame fehlt: DriftKing laeuft als Plugin von MatGame. Bitte https://github.com/Real-TTX/MatGame neben dieses Repository klonen ($matgameRoot)."
}

if ($MatGame) {
    & (Join-Path $matgameRoot 'scripts/redeploy.ps1') -Clean:$Clean
    exit $LASTEXITCODE
}

Push-Location $root
try {
    $compose = @('compose', '-f', 'docker-compose.local.yml')
    if ($Clean) {
        docker @compose down -v
    }
    docker @compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw 'docker compose failed' }
    Write-Host 'DriftKing: http://localhost:2771/driftking/  ·  Admin: http://localhost:2771/Admin/DriftKing  ·  pgAdmin: http://localhost:2778'
}
finally {
    Pop-Location
}
