# TIJE Live – iOS (Capacitor)
Di Mac: `npm install && npx cap sync ios && npx cap open ios`
Xcode: target App > Signing & Capabilities > pilih Team, Bundle ID `id.arfr.tijelive` (ubah bila perlu).
Product > Destination: Any iOS Device (arm64) > Product > Archive > Distribute App > App Store Connect > Upload.
Update web: salin perubahan ke `web/` lalu `npx cap sync ios`. Naikkan Build number tiap upload.

## Buat .ipa (di Mac, Xcode terpasang & sudah login Apple ID di Xcode > Settings > Accounts)
./build-ipa.sh <TEAM_ID>                    # .ipa App Store Connect -> build/ipa/App.ipa
./build-ipa.sh <TEAM_ID> release-testing    # ad-hoc, hanya untuk iPhone yang UDID-nya terdaftar
Upload ke TestFlight: Transporter.app (drag .ipa) atau Xcode Organizer > Distribute App.
