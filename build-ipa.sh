#!/usr/bin/env bash
# Usage: ./build-ipa.sh <TEAM_ID> [app-store-connect|release-testing]
#  app-store-connect : .ipa untuk upload ke App Store Connect / TestFlight
#  release-testing   : .ipa ad-hoc untuk install langsung (UDID iPhone harus terdaftar)
set -euo pipefail
TEAM="${1:?Isi TEAM_ID (10 karakter, dari developer.apple.com > Membership)}"
METHOD="${2:-app-store-connect}"
cd "$(dirname "$0")"
npm install
npx cap sync ios
mkdir -p build
cat > build/ExportOptions.plist <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>${METHOD}</string>
  <key>teamID</key><string>${TEAM}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PL
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/TIJELive.xcarchive \
  DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/TIJELive.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/ipa -allowProvisioningUpdates
echo "Selesai: $(ls build/ipa/*.ipa)"
