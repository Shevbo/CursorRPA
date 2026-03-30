# Запуск на Windows (PowerShell). Копирует C:\dev\CursorRPA\icons agent status\* на сервер.
# Пример:
#   .\scripts\push-icons-agent-status-from-windows.ps1 -Server shectory@shectory.ru -RemoteRoot ~/workspaces/CursorRPA
param(
  [Parameter(Mandatory = $true)][string] $Server,
  [string] $RemoteRoot = "~/workspaces/CursorRPA",
  [string] $LocalDir = "C:\dev\CursorRPA\icons agent status"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $LocalDir)) {
  Write-Error "Нет каталога: $LocalDir"
}
$remoteDest = "$RemoteRoot/icons agent status".Replace("\", "/")
Write-Host "scp -> ${Server}:$remoteDest"
# scp в OpenSSH: пробелы в удалённом пути — в кавычках для ssh
scp -r "${LocalDir}\*" "${Server}:$remoteDest/"
Write-Host "На сервере при необходимости: cd $RemoteRoot && ./scripts/sync-agent-status-gifs.sh && cd shectory-portal && npm run build"
