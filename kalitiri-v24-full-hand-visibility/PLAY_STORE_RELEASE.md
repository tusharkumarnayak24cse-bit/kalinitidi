# Play Store release notes

The Android project is ready to open in Android Studio, but a Play Store release must be signed with a keystore owned by the developer.

1. Open the `android` folder in Android Studio.
2. Choose **Build > Generate Signed Bundle / APK**.
3. Select **Android App Bundle** for Play Store upload.
4. Create or select your own signing keystore and keep its password/private key safe.
5. Choose the `release` build variant and generate the `.aab` file.
6. Upload the signed `.aab` in Google Play Console.

Do not commit your keystore or passwords to GitHub.
