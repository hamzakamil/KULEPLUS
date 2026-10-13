# Geçici dev aracı: apps/api çalıştıran node/tsx süreçlerini durdurur,
# ardından API'yi log'ları logs/api-dev.log içine yazarak yeniden başlatır.
$ErrorActionPreference = 'SilentlyContinue'

# 1) Yalnızca apps/api kodu çalıştıran node/tsx süreçlerini öldür (apps/worker'a dokunma)
$victims = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match 'node' -and $_.CommandLine -match 'apps\\api'
}
foreach ($p in $victims) {
  Stop-Process -Id $p.ProcessId -Force
  Write-Output ("killed {0}" -f $p.ProcessId)
}
Start-Sleep -Seconds 2

# 2) 3000 hâlâ dinleniyorsa direkt kapat (zombie koruma)
$listeners = Get-NetTCPConnection -LocalPort 3000 -State Listen
foreach ($l in $listeners) {
  Stop-Process -Id $l.OwningProcess -Force
  Write-Output ("killed listener {0}" -f $l.OwningProcess)
}
Start-Sleep -Seconds 1

# 3) API'yi log redirect ile yeniden başlat (arka planda, gizli pencere)
Start-Process -FilePath 'cmd.exe' -ArgumentList @(
  '/c',
  'cd /d C:\proje\Muhasebe\apps\api && npx tsx watch src/server.ts > C:\proje\Muhasebe\logs\api-dev.log 2>&1'
) -WindowStyle Hidden

Write-Output 'API restart baslatildi; logs/api-dev.log takip edin.'
