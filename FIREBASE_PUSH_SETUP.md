# Firebase push notifications — setup

The code is fully wired. Push notifications will start working once you do the
one-time Firebase setup below. Until then everything runs normally (the backend
just skips sending, and the app just doesn't register a token).

## What already works (no setup needed)
- Farmer uploads a product-usage photo → saved to the crop.
- Photo shows on the **dashboard** → open a farmer → **"Product usage photos"**.
- Backend already tries to push the farmer's **agronomist** on every upload.

## 1. Create a Firebase project
1. https://console.firebase.google.com → **Add project**.
2. Add an **Android app**. Package name must match your app's Android package
   (set it in `frontend/app.json` under `expo.android.package`, e.g.
   `com.oneroot.app`, then rebuild).
3. Download **`google-services.json`**.

## 2. Wire it into the mobile app (requires a DEV BUILD — not Expo Go)
Push notifications do **not** work in Expo Go. You must make a development build.
1. Put `google-services.json` in `frontend/` (it's git-ignored).
2. In `frontend/app.json`, under `expo.android`, add:
   ```json
   "googleServicesFile": "./google-services.json"
   ```
3. Make sure `expo.android.package` is set.
4. Build a dev client:
   ```bash
   cd frontend
   npx expo install expo-dev-client
   npx eas build --profile development --platform android   # or: npx expo run:android
   ```
5. Install that build on a **physical device** and log in as an **agronomist**.
   The app auto-registers the device token (see `src/lib/push.ts`).

## 3. Wire it into the backend
1. Firebase console → **Project settings → Service accounts → Generate new
   private key** → downloads a JSON.
2. Either:
   - save it as **`backend/serviceAccount.json`** (git-ignored), **or**
   - set env `FIREBASE_SERVICE_ACCOUNT` to the whole JSON on one line.
3. Restart the backend. You should see:
   `🔔 Firebase Admin initialised — push notifications enabled.`

## 4. Test
- Log in as an agronomist on the dev build (registers the token).
- Log in as one of that agronomist's farmers on another device.
- Farmer: open a crop → a day → a product → **Upload photo**.
- The agronomist's phone gets: **"Product applied ✅ — {farmer} applied {product} on {crop}"**.

## Files involved
- Backend: `src/config/firebase.js`, `pushToken` on the User model,
  `PATCH /api/users/:id/push-token`, and the send in `completeProductTask`.
- Mobile: `src/lib/push.ts` (registers token), called from `src/app/_layout.tsx`.
