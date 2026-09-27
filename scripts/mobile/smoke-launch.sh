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
# Cold-launch status comes from am start -W itself; any non-ok status exits
# via adb's non-zero result with set -e active.

# The resumed/focused window field naming varies across Android versions
# (mResumedActivity vs mCurrentFocus/mFocusedApp); poll both for up to 60s.
i=0
FOCUS=""
while [ "$i" -lt 12 ]; do
    FOCUS=$(adb shell dumpsys activity activities 2>/dev/null | grep -i "mResumedActivity" | head -n 1 || true)
    case "${FOCUS}" in *com.aura.marketplace.mobile*) break ;; esac
    FOCUS=$(adb shell dumpsys window 2>/dev/null | grep -iE "mCurrentFocus|mFocusedApp" | head -n 1 || true)
    case "${FOCUS}" in *com.aura.marketplace.mobile*) break ;; esac
    sleep 5
    i=$((i + 1))
done

echo "Focused window: ${FOCUS}"
case "${FOCUS}" in
    *com.aura.marketplace.mobile*) echo "Aura shell resumed and focused." ;;
    *)
        echo "::error::Aura activity did not resume after cold launch."
        adb shell dumpsys activity activities 2>/dev/null | head -n 40 || true
        exit 1
        ;;
esac

if adb logcat -d | grep -q "FATAL EXCEPTION"; then
    echo "::error::FATAL EXCEPTION during smoke launch:"
    adb logcat -d | grep -A 40 "FATAL EXCEPTION"
    exit 1
fi

echo "Emulator smoke launch passed."
