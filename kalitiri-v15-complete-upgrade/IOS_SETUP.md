# Kaali Ni Tidi — iOS App Setup

This project is prepared to become an iPhone/iPad app with Capacitor.

## Multiplayer backend

The iOS app connects to the same live Render server:

https://three-spades.onrender.com

That server continues to handle multiplayer rooms, Socket.IO, bots, bidding, turns and scoring.

## Requirements on your Mac

Install:
1. Node.js
2. Xcode from the Mac App Store
3. Xcode Command Line Tools when Xcode asks

## Fast setup

Open the project folder in VS Code and run:

```bash
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Or double-click:

`setup-ios.command`

If macOS blocks it, right-click the file → Open.

## Run on your own iPhone

1. Connect your iPhone to your Mac.
2. Unlock the iPhone and tap Trust if asked.
3. Open the project in Xcode.
4. Select the **App** target.
5. Open **Signing & Capabilities**.
6. Under **Team**, choose your Apple ID / Personal Team.
7. Keep or change the Bundle Identifier. Example:
   `com.kaalinitidi.game`
8. At the top of Xcode, select your connected iPhone.
9. Press the ▶ Run button.

If iPhone Developer Mode is required:
Settings → Privacy & Security → Developer Mode.

## Simulator

You can also select an iPhone Simulator at the top of Xcode and press ▶ Run.

## App Store build

For App Store submission:

1. Join the Apple Developer Program.
2. Use a unique production Bundle Identifier.
3. In Xcode choose:
   Product → Archive
4. When Organizer opens:
   Distribute App → App Store Connect
5. Upload the build.
6. Finish app information, screenshots, privacy details and review submission in App Store Connect.

## Important production upgrades

Before a public launch, strongly consider:
- Real account authentication
- Redis room/reconnect storage
- PostgreSQL match history
- Privacy policy
- App icon and splash screen
- Error/crash reporting
- Abuse/chat moderation
