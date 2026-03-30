# Запуск из PowerShell (файл .ps1, не копируйте тело скрипта в консоль).
# Копирует каталог «icons agent status» на сервер в <RemoteRoot>/icons agent status/
#
# Пример (из каталога репозитория CursorRPA):
#   .\scripts\push-icons-agent-status-from-windows.ps1 -Server shectory-work
#   .\scripts\push-icons-agent-status-from-windows.ps1 -Server user@host -RemoteRoot ~/workspaces/CursorRPA
param(
  [Parameter(Mandatory = $true)][string] $Server,
  [string] $RemoteRoot = "~/workspaces/CursorRPA",
  [string] $LocalDir = "C:\dev\CursorRPA\icons agent status"
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $LocalDir -PathType Container)) {
  Write-Error "Нет каталога: $LocalDir"
}

$localFull = (Resolve-Path -LiteralPath $LocalDir).Path
$scpExe = (Get-Command scp -ErrorAction Stop).Source

# Git for Windows: /usr/bin/scp не находит C:\... и не раскрывает "*"; нужен путь вида /c/dev/...
# Встроенный OpenSSH обычно понимает C:/... без "*"
$localForScp = $localFull
if ($scpExe -match '[\\/]Git[\\/].*[\\/]usr[\\/]bin[\\/]scp') {
  if ($localFull -match '^([A-Za-z]):\\(.*)$') {
    $d = $matches[1].ToLowerInvariant()
    $tail = $matches[2] -replace '\\', '/'
    $localForScp = "/$d/$tail"
  }
} else {
  $localForScp = $localFull -replace '\\', '/'
}

$remoteParent = ($RemoteRoot.TrimEnd('/\')).Replace('\', '/')

Write-Host "scp: $scpExe"
Write-Host "local:  $localForScp"
Write-Host "remote: ${Server}:${remoteParent}/  (появится подкаталог «icons agent status»)"

# Копируем всю папку — без "*", иначе stat local "...*": No such file
$remoteArg = "${Server}:${remoteParent}/"
& scp -r $localForScp $remoteArg
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "OK. На сервере: cd $RemoteRoot; ./scripts/sync-agent-status-gifs.sh; cd shectory-portal; npm run build"
