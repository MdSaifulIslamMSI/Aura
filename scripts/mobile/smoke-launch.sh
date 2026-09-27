#!/bin/sh
# Cold-launch smoke test for the signed Android shell, executed by the
# emulator smoke lane (mobile-release.yml). Runs as a FILE so the
# emulator-runner's script interpolation cannot touch shell variables.
#
# Usage: sh scripts/mobile/smoke-launch.sh <workspace>
set -eu

WORKSPACE="${1:-/home/runner/work/Aura/Aura}"
APK_DIR="${WORKSPACE}/release-artifacts/android"

ls -la "${APK_DIR}"

APK=$(find "${APK_DIR}" -type f -name 'Aura-Marketplace-Android-*.apk' | head -n 1)
echo "Smoke-installing ${APK}"
if [ -z "${APK}" ]; then
    echo "::error::No Android APK artifact found in ${APK_DIR}."
    exit 1
fi

adb install -r "${APK}"
adb logcat -c
adb shell am start -W -n com.aura.marketplace.mobile/.MainActivity
sleep 45

FOCUS=$(adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -n 1 || true)
echo "Focused window: ${FOCUS}"
echo "${FOCUS}" | grep -qi "com.aura.marketplace.mobile" || {
    echo "::error::Aura activity did not take focus after cold launch."
    exit 1
}

if adb logcat -d | grep -q "FATAL EXCEPTION"; then
    echo "::error::FATAL EXCEPTION during smoke launch:"
    adb logcat -d | grep -A 40 "FATAL EXCEPTION"
    exit 1
fi

echo "Emulator smoke launch passed."
