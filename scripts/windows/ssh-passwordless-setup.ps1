<#
ssh-passwordless-setup.ps1

PowerShell скрипт для Windows: настраивает SSH по ключу (без пароля) к удалённой Ubuntu.

Что делает:
1) Спрашивает Host/IP, User, Password (secure)
2) Генерирует ed25519 ключ (если нет)
3) Подключается по паролю через Posh-SSH (SSH.NET) и добавляет public key в ~/.ssh/authorized_keys
4) Добавляет алиас в %USERPROFILE%\.ssh\config

Требования:
- Windows PowerShell 5+ или PowerShell 7+
- Доступ к удалённому SSH по паролю (первый раз)
- Модуль Posh-SSH (установится автоматически при необходимости)

Запуск:
  powershell -ExecutionPolicy Bypass -File .\ssh-passwordless-setup.ps1
#>

$ErrorActionPreference = "Stop"

function Ensure-PoshSsh {
  if (Get-Module -ListAvailable -Name Posh-SSH) { return }
  Write-Host "[setup] Устанавливаю модуль Posh-SSH (требуется один раз)..." -ForegroundColor Yellow
  try {
    Set-PSRepository -Name "PSGallery" -InstallationPolicy Trusted -ErrorAction SilentlyContinue | Out-Null
  } catch { }
  Install-Module Posh-SSH -Scope CurrentUser -Force
}

function Ensure-SshKey([string]$KeyPath) {
  $pub = "$KeyPath.pub"
  if (Test-Path $KeyPath -PathType Leaf -and Test-Path $pub -PathType Leaf) { return }

  $dir = Split-Path -Parent $KeyPath
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

  Write-Host "[setup] Генерирую ed25519 ключ: $KeyPath" -ForegroundColor Yellow

  # В PowerShell иногда ломается -N "" → используем cmd
  $cmd = "ssh-keygen -t ed25519 -f `"$KeyPath`" -C `"win->ssh-passwordless`" -N `"`""
  cmd /c $cmd | Out-Null
}

function Upsert-SshConfigAlias([string]$Alias, [string]$HostName, [string]$User, [string]$IdentityFile) {
  $sshDir = Join-Path $env:USERPROFILE ".ssh"
  $cfg = Join-Path $sshDir "config"
  if (!(Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }

  $block = @"

Host $Alias
  HostName $HostName
  User $User
  IdentityFile $IdentityFile
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
"@

  if (!(Test-Path $cfg)) {
    Set-Content -Path $cfg -Value $block -Encoding ascii
    return
  }

  # Удаляем существующий Host-блок этого алиаса без сложных regex (стабильно для PS 5/7)
  $lines = Get-Content -Path $cfg
  $out = New-Object System.Collections.Generic.List[string]
  $skip = $false
  $hostLine = ("Host " + $Alias).ToLowerInvariant()

  foreach ($line in $lines) {
    $trim = ($line.Trim())
    $trimLower = $trim.ToLowerInvariant()

    if ($trimLower -like "host *") {
      # Начало нового блока Host
      if ($trimLower -eq $hostLine) {
        $skip = $true
        continue
      }
      $skip = $false
    }

    if (-not $skip) {
      [void]$out.Add($line)
    }
  }

  # Склеиваем обратно + добавляем новый блок
  $newContent = ($out -join "`r`n").TrimEnd() + $block
  Set-Content -Path $cfg -Value $newContent -Encoding ascii
}

function Add-PublicKeyToRemoteAuthorizedKeys([string]$HostName, [string]$User, [securestring]$Password, [string]$PublicKeyPath) {
  Import-Module Posh-SSH -ErrorAction Stop

  $pub = (Get-Content -Path $PublicKeyPath -Raw).Trim()
  if (!$pub.StartsWith("ssh-ed25519 ")) { throw "Публичный ключ выглядит странно: $PublicKeyPath" }

  $cred = New-Object System.Management.Automation.PSCredential($User, $Password)
  $session = New-SSHSession -ComputerName $HostName -Credential $cred -AcceptKey -ConnectionTimeout 15
  try {
    $cmds = @(
      "set -e",
      "mkdir -p ~/.ssh",
      "chmod 700 ~/.ssh",
      "touch ~/.ssh/authorized_keys",
      "chmod 600 ~/.ssh/authorized_keys",
      # Добавляем ключ, если его ещё нет
      "grep -qxF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys",
      "echo OK"
    ) -join " && "

    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmds
    if ($r.ExitStatus -ne 0) {
      throw ("Удалённая команда завершилась с кодом {0}: {1}" -f $r.ExitStatus, ($r.Error -join "`n"))
    }
  } finally {
    Remove-SSHSession -SessionId $session.SessionId | Out-Null
  }
}

Write-Host "=== SSH passwordless setup (Windows) ===" -ForegroundColor Cyan

$HostName = Read-Host "Host/IP (например 192.168.1.50)"
$User = Read-Host "Login (например shevbo)"
$Alias = Read-Host "SSH alias в config (например shevbo-pi)"
if ([string]::IsNullOrWhiteSpace($Alias)) { $Alias = $HostName }
$Password = Read-Host -AsSecureString "Password (ввод скрыт; нужен только 1 раз для установки ключа)"

Ensure-PoshSsh

$keyName = ($Alias -replace "[^a-zA-Z0-9._-]", "_")
$KeyPath = Join-Path $env:USERPROFILE ".ssh\$keyName`_ed25519"
Ensure-SshKey -KeyPath $KeyPath

Write-Host "[setup] Добавляю public key на сервер ($HostName)..." -ForegroundColor Yellow
Add-PublicKeyToRemoteAuthorizedKeys -HostName $HostName -User $User -Password $Password -PublicKeyPath "$KeyPath.pub"

Write-Host "[setup] Обновляю ~/.ssh/config..." -ForegroundColor Yellow
Upsert-SshConfigAlias -Alias $Alias -HostName $HostName -User $User -IdentityFile "~/.ssh/$($keyName)_ed25519"

Write-Host "[done] Готово. Проверка:" -ForegroundColor Green
Write-Host "  ssh -o BatchMode=yes $Alias `"echo OK`""

