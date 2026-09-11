# Run this ONCE as Administrator to allow phone access on the same Wi‑Fi.
# Right-click PowerShell → Run as administrator → paste these lines:

New-NetFirewallRule -DisplayName "Gita Guide Vite 5173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Any -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Gita Guide API 8000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Any -ErrorAction SilentlyContinue

Write-Host "Firewall rules added. On your phone open: http://$((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match 'Wi-Fi' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1 -ExpandProperty IPAddress)):5173"
