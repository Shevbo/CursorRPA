#!/usr/bin/env bash
# Запускать на dev-VM (Ubuntu 22.04/24.04), не от root для установки в $HOME.
set -euo pipefail

echo "==> Базовые пакеты (нужен sudo)"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates git jq

echo "==> Установка Cursor Agent CLI (официальный инсталлятор)"
curl https://cursor.com/install -fsS | bash

echo "==> Подсказка: откройте новую сессию shell или выполните: source ~/.bashrc"
echo "==> Задайте ключ: export CURSOR_API_KEY='...' или добавьте в ~/.bashrc"
echo "==> Проверка: agent status && agent about"
