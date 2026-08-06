#!/usr/bin/env bash
# Decompile a pulled APK and grep out the BLE protocol details.
set -uo pipefail

cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
  echo "Usage: tools/decompile.sh <package.name>"
  echo "Available:"
  ls apk/*.apk 2>/dev/null || echo "  (none - run tools/android_pull.sh first)"
  exit 1
fi

PKG="$1"
APK="apk/${PKG}.apk"
OUT="decompiled/${PKG}"

[ -f "$APK" ] || { echo "Missing $APK"; exit 1; }

echo "=== Decompiling $APK (this takes a minute) ==="
mkdir -p "$OUT"
# -d output, --no-debug-info keeps the source readable, -j parallel jobs.
jadx --no-debug-info -j 4 -d "$OUT" "$APK" 2>&1 | tail -15

SRC="$OUT/sources"
echo
echo "=== GATT UUIDs referenced in the app ==="
# 128-bit UUIDs, plus the 16-bit shorthand these SDKs often build from.
grep -rhoE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' \
  "$SRC" 2>/dev/null | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn | head -40

echo
echo "=== Files touching BLE writes ==="
grep -rlE 'writeCharacteristic|setValue|BluetoothGattCharacteristic|writeValue' \
  "$SRC" 2>/dev/null | head -30

echo
echo "=== Likely protocol / frame-builder classes ==="
grep -rliE 'protocol|command|packet|frame|payload|bitmap|matrix|crc' \
  "$SRC" 2>/dev/null | grep -viE 'android/|androidx/|kotlin/|com/google/' | head -30

echo
echo "Decompiled to $OUT/sources"
echo "Read the frame-builder classes above - they contain the byte layout."
