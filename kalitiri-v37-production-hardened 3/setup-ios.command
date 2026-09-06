#!/bin/bash
set -e

echo "Kaali Ni Tidi - iOS setup"
echo "1/4 Installing packages..."
npm install

if [ ! -d "ios" ]; then
  echo "2/4 Creating iOS project..."
  npx cap add ios
else
  echo "2/4 iOS project already exists."
fi

echo "3/4 Syncing web files..."
npx cap sync ios

echo "4/4 Opening Xcode..."
npx cap open ios
