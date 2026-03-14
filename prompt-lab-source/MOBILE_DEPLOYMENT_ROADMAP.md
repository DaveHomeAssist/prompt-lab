# Prompt Lab Mobile Deployment Roadmap

## Goal

Ship Prompt Lab on iOS and Android without forking the shared frontend unless mobile constraints force it.

The desired architecture is:

- shared React app in `prompt-lab-extension/src/`
- desktop shell in `prompt-lab-desktop/`
- future mobile shell in a Tauri Mobile project

## Current baseline

Already in place:

- platform abstraction in `src/lib/platform.js`
- shared provider layer in `src/lib/providers.js`
- shared provider registry in `src/lib/providerRegistry.js`
- desktop-specific settings path via `desktopApi.js`
- extension CI and desktop CI

Not yet started:

- Tauri Mobile init
- mobile-safe API key storage
- mobile-specific UI adjustments
- app store packaging and signing

## Phase 0: Preconditions

These should be done before mobile work starts:

1. Desktop CI must pass on macOS, Windows, and Linux.
2. Desktop release posture must be decided:
   - internal/dev artifact
   - public downloadable app
3. The shared platform boundary must stay clean:
   - shared UI imports `platform.js`
   - runtime-specific modules stay behind adapters
4. The mobile provider-call architecture must be locked before implementation starts.

Recommended decision:

- use a Rust command bridge via Tauri commands for mobile provider calls
- do not treat direct webview `fetch` as the long-term mobile path

Rationale:

- it keeps provider secrets out of general JavaScript flow
- it centralizes provider-call policy and error handling
- it aligns better with native secure storage and mobile plugin integration

## Phase 1: Mobile shell scaffold

1. Create a new mobile project, likely `prompt-lab-mobile/`.
2. Initialize Tauri Mobile targets:
   - `cargo tauri android init`
   - `cargo tauri ios init`
3. Mirror the desktop pattern:
   - local `vite.config.js`
   - local `tailwind.config.js`
   - `index.html` importing `../prompt-lab-extension/src/main.jsx`
   - mobile-only shell concerns such as meta tags, safe-area handling, and shell-specific CSS stay in the mobile shell rather than the shared UI
4. Add a mobile README with setup prerequisites:
   - Xcode
   - Android Studio / SDK
   - Rust mobile targets

Exit criteria:

- iOS simulator app boots
- Android emulator app boots
- shared frontend renders without a separate UI fork

## Phase 2: Platform adapter for mobile

1. Extend `src/lib/platform.js` with a mobile branch.
2. Implement provider calls through the chosen native/Rust bridge.
3. Create a mobile-specific adapter for:
   - provider settings
   - session persistence
   - open settings action
4. Keep the shared UI talking only to platform-level APIs.

Recommended direction:

- keep provider logic shared in `src/lib/providers.js`
- keep mobile-specific storage and native integration behind the mobile adapter
- use Tauri IPC plus a native-side HTTP client instead of exposing mobile networking decisions to the shared UI

Exit criteria:

- Enhance flow works on simulator/emulator
- settings persist across app restarts

## Phase 3: Secure storage and secrets

Mobile cannot treat localStorage as a final answer for provider secrets.

Required work:

1. Use secure storage for API keys:
   - iOS Keychain
   - Android Keystore / encrypted preferences
   - likely through a dedicated Tauri secure-storage plugin rather than a browser-style abstraction
2. Separate secret storage from general app state.
3. Define migration rules if early builds start with plain local storage.
4. Document exact storage behavior in privacy docs.

Constraints and pattern:

- there is no single built-in cross-platform secret store that removes this design work
- mobile secure storage is an explicit platform-plugin choice
- store only the minimum secret material needed in secure storage; keep general UI state elsewhere

Exit criteria:

- API keys are not stored in plain localStorage in production mobile builds

## Phase 4: Mobile UX pass

1. Audit all major screens on narrow viewports:
   - editor
   - library
   - A/B test
   - composer
   - settings
2. Rework interactions that assume desktop width or pointer precision.
3. Add mobile-safe affordances for:
   - keyboard overlap
   - safe areas / notch padding
   - scroll behavior inside modals
   - long-form text editing
4. Validate the extension's panel-first tabs and sidebar assumptions for touch:
   - tap target sizes
   - spacing
   - layout density
5. Decide whether any desktop-first tabs should be deferred on first mobile release.

Exit criteria:

- app is usable on phone-sized screens without hidden controls or dead-end layouts

## Phase 5: Testing and CI

1. Add mobile smoke tests at the platform adapter level.
2. Keep browser-side unit coverage in Vitest for shared logic.
3. Add a lightweight manual QA matrix for:
   - iPhone simulator
   - Android emulator
   - at least one physical device if available
4. Add CI only after the mobile project structure stabilizes.

Important constraint:

- desktop-style E2E assumptions do not transfer cleanly to iOS/Android; expect more manual validation early on.
- use Tauri's WebDriver support where feasible, but expect more manual validation on real devices in early mobile releases.

## Phase 6: Release preparation

1. Prepare signing and provisioning:
   - Apple Developer account
   - Android signing key
2. Prepare store listing assets and policy copy.
3. Review provider network behavior and privacy disclosures for store compliance.
4. Decide launch scope:
   - full provider set
   - or a narrower first-release provider set
   - likely exclude Ollama on mobile v1 unless a remote bridge is added

Exit criteria:

- signed release candidates install cleanly on target devices

## Major risks

- mobile webview networking and CSP behavior may differ from desktop assumptions
- Tauri mobile uses its own protocol and native HTTP/client behavior rather than a plain localhost dev-server model, so browser-style CORS assumptions do not always carry over cleanly
- secure secret storage adds native complexity not present in desktop
- some current screens may not translate well to phone-sized layouts
- iOS distribution overhead is materially higher than desktop packaging
- Ollama depends on localhost access; on iOS/Android that does not map to the user's desktop Ollama instance, so it should be treated as desktop-only unless a remote bridge is added

## Recommendation

Start mobile only after desktop CI is green and the desktop branch is stable.

The best first mobile milestone is not app-store release. It is:

- boot shared UI on iOS + Android
- persist settings securely
- run one successful enhance request end to end
