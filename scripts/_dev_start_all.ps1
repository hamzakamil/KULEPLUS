# Gelistirme ortamini bastan baslatir:
# 1) Muhasebe'ye ait node/tsx/vite sureclerini oldurur (astro site + baska projelere dokunmaz)
# 2) API, Worker ve Web'i log redirect ile yeniden baslatir
$ErrorActionPreference = 'SilentlyContinue'

$victims = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match 'node' -and $_.CommandLine -match 'Muhasebe' -and $_.CommandLine -notmatch 'astro'
}
foreach ($p in $victims) {
  Stop-Process -Id $p.ProcessId -Force
  Write-Output ("killed " + $p.ProcessId)
}

# Port 3000/5173 hala doluyssa dinleyicileri kapat
foreach ($port in 3000, 5173) {
  foreach ($l in (Get-NetTCPConnection -LocalPort $port -State Listen)) {
    Stop-Process -Id $l.OwningProcess -Force
    Write-Output ("killed listener $port -> " + $l.OwningProcess)
  }
}
Start-Sleep -Seconds 2

New-Item -ItemType Directory -Force -Path C:\proje\Muhasebe\logs | Out-Null

Start-Process cmd.exe -ArgumentList '/c', 'cd /d C:\proje\Muhasebe\apps\api && npx tsx watch src/server.ts > C:\proje\Muhasebe\logs\api-dev.log 2>&1' -WindowStyle Hidden
Start-Process cmd.exe -ArgumentList '/c', 'cd /d C:\proje\Muhasebe\apps\worker && npx tsx watch src/runner.ts > C:\proje\Muhasebe\logs\worker-dev.log 2>&1' -WindowStyle Hidden
Start-Process cmd.exe -ArgumentList '/c', 'cd /d C:\proje\Muhasebe\apps\web && npx vite > C:\proje\Muhasebe\logs\web-dev.log 2>&1' -WindowStyle Hidden

Write-Output 'Servisler baslatildi -> logs/api-dev.log, logs/worker-dev.log, logs/web-dev.log'
