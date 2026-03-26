# Запуск shectory-create-user.sh на сервере (scp + ssh).
# Требуется: ssh/scp в PATH, ключ для Host shectory (User ubuntu).
#
# Запуск — ОДНА строка (копирование из чата склеивает многострочные блоки):
#   & './scripts/shectory-run-create-user.ps1'
# Либо двойной щелчок: shectory-run-create-user.cmd в этой же папке.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$src = Join-Path $here "shectory-create-user.sh"
if (-not (Test-Path $src)) { throw "Не найден: $src" }

# Нормализация CRLF -> LF перед отправкой (на диске временный файл)
$text = [System.IO.File]::ReadAllText($src)
$text = $text -replace "`r`n", "`n" -replace "`r", "`n"
$enc = New-Object System.Text.UTF8Encoding $false
$tmp = [System.IO.Path]::GetTempFileName() + ".sh"
[System.IO.File]::WriteAllText($tmp, $text, $enc)

$SshHost = "shectory"
$RemotePath = "/tmp/shectory-create-user.sh"

& scp -o BatchMode=yes $tmp "${SshHost}:${RemotePath}"
if ($LASTEXITCODE -ne 0) { Remove-Item $tmp -Force; throw "scp failed" }
Remove-Item $tmp -Force

# Запуск (LF уже в файле; не вставляйте скрипт в PS вручную)
& ssh -o BatchMode=yes $SshHost "bash $RemotePath"
exit $LASTEXITCODE
