/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry, NativeModules } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

const localNotification = NativeModules.LocalNotification;

messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('Background FCM message:', JSON.stringify(remoteMessage));

  const title =
    remoteMessage?.notification?.title ||
    String(remoteMessage?.data?.title || 'Upanaya');
  const body =
    remoteMessage?.notification?.body ||
    String(remoteMessage?.data?.body || remoteMessage?.data?.message || 'You have a new notification.');

  // Fallback display for data-only messages while app is background/quit.
  if (localNotification?.display) {
    try {
      await localNotification.display(title, body);
    } catch (error) {
      console.log('Local notification fallback failed:', error);
    }
  }
});

AppRegistry.registerComponent(appName, () => App);
