# Online demo through a temporary Cloudflare tunnel (Windows PowerShell 5.1+ or PowerShell 7).
#
#   Start: double-click demo-online.cmd  (or: powershell -ExecutionPolicy Bypass -File demo-online.ps1)
#   Stop:  press Enter in this window (or Ctrl+C)
#
# What it does: starts the Docker demo, opens a trycloudflare.com tunnel to localhost:3000,
# writes docker-compose.override.yml with the public URL (needed by the CSRF origin check and
# for links in e-mails), restarts the app and prints the links. On exit it closes the tunnel,
# removes the override and puts the app back to http://localhost:3000.
# Messages are in Italian for the owner; the demo keeps demo settings (see README "Deployment").
param(
  # Rebuild the Docker image first (after "git pull" with code changes).
  [switch]$Build
)

# 'Continue', not 'Stop': in Windows PowerShell 5.1 redirected stderr of native tools (docker) would
# otherwise throw. Native commands are checked through $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

$override = Join-Path $PSScriptRoot 'docker-compose.override.yml'
$logOut = Join-Path $env:TEMP 'bookme-tunnel-out.log'
$logErr = Join-Path $env:TEMP 'bookme-tunnel.log'
$tunnel = $null

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) {
  Say ''
  Say "ERRORE: $text" 'Red'
  Say ''
  Read-Host 'Premi Invio per chiudere'
  exit 1
}
function Wait-Healthy([int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop -Uri 'http://localhost:3000/api/health'
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

Say ''
Say '=== Bookme - demo online ===' 'Cyan'
Say ''

# 1. Preconditions
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker non trovato. Installa e avvia Docker Desktop.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop non è avviato. Aprilo, aspetta "Engine running" e rilancia lo script.' }
# A terminal opened before "winget install" (e.g. the one inside Docker Desktop) still has the old
# PATH: reload it from Windows, then also look in the folders winget and the MSI install to.
function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe"
  )
  $pkgs = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
  if (Test-Path -LiteralPath $pkgs) {
    $candidates += Get-ChildItem -LiteralPath $pkgs -Filter 'cloudflared*.exe' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
  }
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}
$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
  Fail "cloudflared non trovato. Installalo con:`n  winget install Cloudflare.cloudflared`npoi chiudi e riapri la finestra e rilancia lo script."
}

try {
  # 2. Start the demo locally (without an old override, so the first start is plain localhost)
  if (Test-Path -LiteralPath $override) { Remove-Item -LiteralPath $override }
  Say '1/4  Avvio della demo in Docker...'
  if ($Build) { docker compose up --build -d } else { docker compose up -d }
  if ($LASTEXITCODE -ne 0) { Fail 'docker compose non è partito. Guarda i messaggi qui sopra.' }
  if (-not (Wait-Healthy 180)) { Fail 'L''app non risponde su http://localhost:3000. Controlla i Logs del container "app" in Docker Desktop.' }

  # 3. Open the tunnel and read its public address from the log
  Say '2/4  Apertura del tunnel...'
  Remove-Item -LiteralPath $logOut, $logErr -ErrorAction SilentlyContinue
  $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--url', 'http://localhost:3000') `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr -NoNewWindow -PassThru -ErrorAction Stop
  $url = $null
  $deadline = (Get-Date).AddSeconds(60)
  while (-not $url -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    if ($tunnel.HasExited) { break }
    foreach ($f in @($logErr, $logOut)) {
      if (Test-Path -LiteralPath $f) {
        $m = Select-String -LiteralPath $f -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
      }
    }
  }
  if (-not $url) { Fail "Il tunnel non ha fornito un indirizzo. Log: $logErr" }

  # 4. Tell the app its public address and restart it
  Say "3/4  Indirizzo pubblico: $url"
  $yaml = @"
# Written by demo-online.ps1 - removed again when the script stops. Do not commit.
services:
  app:
    environment:
      PUBLIC_BASE_URL: $url
      TRUST_PROXY: "true"
"@
  Set-Content -LiteralPath $override -Value $yaml -Encoding ascii
  Say '4/4  Riavvio dell''app con l''indirizzo pubblico...'
  docker compose up -d app
  if ($LASTEXITCODE -ne 0) { Fail 'Riavvio dell''app non riuscito. Guarda i messaggi qui sopra.' }
  if (-not (Wait-Healthy 120)) { Fail 'L''app non risponde dopo il riavvio. Controlla i Logs del container "app".' }

  $booking = "$url/salon-beispiel/buchen"
  try { Set-Clipboard -Value $booking } catch { }

  Say ''
  Say 'La demo è ONLINE:' 'Green'
  Say ''
  Say "  Homepage:       $url/salon-beispiel" 'White'
  Say "  Prenotazione:   $booking   (copiato negli appunti)" 'White'
  Say "  Area staff:     $url/salon-beispiel/team   (maria / demo-passwort-2026)" 'White'
  Say ''
  Say 'Attenzione: è una demo pubblica. Chi ha il link può entrare con le password demo;' 'Yellow'
  Say 'non inserire dati veri di clienti.' 'Yellow'
  Say ''
  Say 'Il primo caricamento può richiedere qualche secondo, il tempo che il tunnel si attivi.'
  Say 'Lascia aperta questa finestra. Per spegnere il tunnel premi Invio.' 'Cyan'
  Read-Host | Out-Null
}
finally {
  # Runs on Enter, on Ctrl+C and after errors: close the tunnel and go back to localhost.
  Say ''
  Say 'Spegnimento del tunnel...'
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $override) {
    Remove-Item -LiteralPath $override
    docker compose up -d app *> $null
    Say 'App riportata su http://localhost:3000 (la demo locale resta accesa; per fermarla: docker compose down).'
  }
}
