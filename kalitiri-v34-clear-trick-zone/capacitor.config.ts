import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kaalinitidi.game',
  appName: 'Kaali Ni Tidi',
  webDir: 'public',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor'
  }
};

export default config;
