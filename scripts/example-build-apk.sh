#!/usr/bin/env bash
# Пример BUILD_APK_SCRIPT: сборка debug APK (нужны JDK + Android SDK в PATH).
set -euo pipefail
# cd "${WORKSPACE}/android" && ./gradlew assembleDebug
# cp app/build/outputs/apk/debug/app-debug.apk "${WORKSPACE}/artifacts/"
echo "Заглушка: установите Android SDK и раскомментируйте gradle. WORKSPACE=${WORKSPACE:-}"
