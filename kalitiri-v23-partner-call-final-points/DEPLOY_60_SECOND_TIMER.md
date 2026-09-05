# Deploying the 60-second timer

The game timer is server-authoritative. Updating only the APK is not enough.

## Render
Set this Environment variable on the existing Render service:

`TURN_TIMEOUT_MS=60000`

Then redeploy the service.

If you deploy from `render.yaml`, this project already contains `value: 60000`.

## Android
From the project root:

```bash
npm install
npx cap sync android
npx cap open android
```

Then rebuild the APK in Android Studio.

The packaged Android UI also starts its countdown at 60 seconds and follows the server's authoritative `actionTimeoutMs` value.
