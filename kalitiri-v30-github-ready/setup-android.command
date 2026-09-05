#!/bin/bash
set -e

echo "Kaali Ni Tidi - Android setup"
echo "1/4 Installing packages..."
npm install

if [ ! -d "android" ]; then
  echo "2/4 Creating Android project..."
  npx cap add android
else
  echo "2/4 Android project already exists."
fi

echo "3/4 Syncing web files..."
npx cap sync android

echo "4/4 Opening Android Studio..."
npx cap open android
