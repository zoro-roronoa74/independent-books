# Independent Books on Android 📱

You can run and use **Independent Books** on any Android smartphone or tablet in two ways:

---

## ⚡ Method 1: Instant Wi-Fi PWA (Recommended — 0 Seconds Setup)

You don't need to compile anything. Independent Books has a built-in mobile-responsive Progressive Web App (PWA) engine.

### Steps:
1. On your Windows PC or Mac, launch the server in LAN mode:
   ```powershell
   # Windows PowerShell
   .\Launch.ps1 -Lan
   ```
   Or using Python:
   ```bash
   python app_server.py --lan
   ```
2. The terminal will display your local network IP:
   ```text
   📱 Mobile / Android access on same Wi-Fi: http://192.168.1.X:3543
   ```
3. Connect your Android phone to the **same Wi-Fi network**.
4. Open **Google Chrome** on your Android phone and navigate to `http://192.168.1.X:3543`.
5. Tap Chrome's menu (three dots in top right) &rarr; tap **"Add to Home Screen"** or **"Install App"**.
6. An **Independent Books** icon will be added to your Android phone launcher. When tapped, it opens in full-screen, native standalone app mode!

---

## 🛠️ Method 2: Standalone Android APK (`IndependentBooks.apk`)

For enterprise or custom deployments, you can compile the standalone Android APK using Android Studio or Gradle:

### Prerequisites:
- Android Studio Hedgehog / Iguana / Jellyfish (or Android SDK command line tools)
- JDK 17+

### Build Steps:
```bash
cd android
./gradlew assembleDebug
```
The generated APK will be at:
`android/app/build/outputs/apk/debug/app-debug.apk`

Transfer this `.apk` to your phone and install!
