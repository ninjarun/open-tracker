import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    // Add these missing properties:
    shouldShowBanner: true, 
    shouldShowList: true,
  }),
});

export async function configureLocalNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  return status === 'granted';
}

export async function dispatchLocalPriceAlertNotification(params: {
  ticker: string;
  direction: 'ABOVE' | 'BELOW';
  threshold: number;
  currentPrice: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${params.ticker} price alert`,
      body: `${params.ticker} is ${params.direction.toLowerCase()} $${params.threshold.toLocaleString()} at $${params.currentPrice.toLocaleString()}.`,
      data: {
        ticker: params.ticker,
        direction: params.direction,
        threshold: params.threshold,
        currentPrice: params.currentPrice,
      },
    },
    trigger: null,
  });
}
