Write-Host "=== MOMENTUM NETWORK RESET PROTOCOL ===" -ForegroundColor Cyan
Write-Host "Requesting Administrator Privileges..."

netsh winsock reset
netsh int ip reset
ipconfig /release
ipconfig /renew
ipconfig /flushdns

Write-Host "Network reset complete." -ForegroundColor Green
Write-Host "Reboot is required to take effect." -ForegroundColor Yellow
Write-Host "Restarting your computer in 10 seconds. Press CTRL+C to cancel." -ForegroundColor Red

Start-Sleep -Seconds 10
Restart-Computer
