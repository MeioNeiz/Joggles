#!/usr/bin/env bash
# Find the vendor app on a connected Android phone and pull its APK for
# decompilation. Requires USB debugging enabled on the phone.
set -uo pipefail

cd "$(dirname "$0")/.."
mkdir -p apk

echo "=== Connected devices ==="
adb devices -l
echo

if ! adb get-state >/dev/null 2>&1; then
  cat <<'EOF'
No device in "device" state.

On the phone:
  1. Settings > About phone > tap "Build number" 7 times
  2. Settings > System > Developer options > enable "USB debugging"
  3. Plug into the Mac, then accept the "Allow USB debugging?" prompt

Then rerun this script.
EOF
  exit 1
fi

echo "=== Third-party packages (the vendor app is one of these) ==="
# Vendor apps for this gear are rarely on Play Store under an obvious name, so
# list everything non-system and let the human pick.
adb shell pm list packages -3 | sed 's/^package://' | sort
echo

if [ $# -eq 0 ]; then
  cat <<'EOF'
Usage: tools/android_pull.sh <package.name>

Pick the vendor app from the list above and rerun with its package name.
Grep hints: led, glass, mask, light, ble, bt, smart, magic
EOF
  exit 0
fi

PKG="$1"
echo "=== Pulling $PKG ==="
PATHS=$(adb shell pm path "$PKG" | sed 's/^package://' | tr -d '\r')
if [ -z "$PATHS" ]; then
  echo "Package $PKG not found on device."
  exit 1
fi

i=0
while IFS= read -r remote; do
  [ -z "$remote" ] && continue
  if [ "$i" -eq 0 ]; then
    local_name="apk/${PKG}.apk"
  else
    # Split APKs: base plus config/feature slices. jadx only needs base, but
    # native libs and resources can live in the splits.
    local_name="apk/${PKG}.split${i}.apk"
  fi
  echo "  $remote -> $local_name"
  adb pull "$remote" "$local_name" >/dev/null || echo "    pull FAILED"
  i=$((i + 1))
done <<< "$PATHS"

echo
echo "=== Pulled ==="
ls -lh apk/
echo
echo "Next: tools/decompile.sh $PKG"
