declare module '@tauri-apps/plugin-notification' {
  export function isPermissionGranted(): Promise<boolean>;
  export function requestPermission(): Promise<'granted' | 'denied' | 'default'>;
  export function sendNotification(notification: { title: string; body: string }): void;
}
