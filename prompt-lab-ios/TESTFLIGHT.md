# TestFlight internal testing

The Xcode project is ready to archive. This file is the rest of the upload, which has to happen on a Mac signed into the Apple Developer team that will own the app. The project does not set a development team or a signing certificate.

Bundle ID: `com.davehomeassist.promptlab`

Display name: Prompt Lab

Marketing version and build number: `1.9.0`, the same product version as `prompt-lab-source/package.json`. `npm run version:bump` updates both `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`. App Store Connect rejects a second upload that reuses a build number, so the next archive needs a higher build.

## On the Mac

1. In Certificates, Identifiers & Profiles, register the App ID `com.davehomeassist.promptlab` under the existing team if it is not registered yet. Enable no extra capabilities. The app does not use iCloud, push, or associated domains.
2. In App Store Connect, create an iOS app with that bundle ID, the name Prompt Lab, and the SKU you prefer. Primary language English.
3. Open `prompt-lab-ios/PromptLab.xcodeproj` in Xcode. On the PromptLab target, Signing & Capabilities, select the team. Leave "Automatically manage signing" on. Do not commit the team ID.
4. Select Any iOS Device (arm64), then Product → Archive.
5. In the Organizer, Distribute App → App Store Connect → Upload. Wait until the build finishes processing.
6. In TestFlight, add internal testers from the team. Internal testing does not need Beta App Review.

## Answers already in the project

- Encryption: `ITSAppUsesNonExemptEncryption` is false. The app uses HTTPS and the system Keychain only. If App Store Connect still asks, answer that the app does not use non-exempt encryption.
- Privacy: `PrivacyInfo.xcprivacy` declares no tracking. The only collected type is Other User Content, not linked to identity and not used for tracking, for app functionality. That is the prompt text sent to Anthropic when someone taps Enhance. The Anthropic key stays in the device Keychain and is sent only as the request credential. Match the App Store Connect privacy questionnaire to that manifest.
- Icon: `AppIcon` is a 1024×1024 image with no transparency, taken from the desktop app icon.
- The public contact, if a form asks for one, is avbydave@gmail.com.

## What the archive does not include

A development team, a provisioning profile, or a distribution certificate. Those stay on the Mac.
