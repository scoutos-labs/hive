// Tauri notifications (desktop only)
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

let notificationsEnabled = false;

export async function initNotifications() {
  try {
    const granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      notificationsEnabled = permission === 'granted';
    } else {
      notificationsEnabled = true;
    }
  } catch {
    // Not running in Tauri (web), ignore
    notificationsEnabled = false;
  }
}

export function notifyAgentComplete(agentId: string, channelName: string) {
  if (!notificationsEnabled) return;
  
  sendNotification({
    title: `@${agentId} completed`,
    body: `Task finished in #${channelName}`,
  });
}

export function notifyAgentFailed(agentId: string, channelName: string, error?: string) {
  if (!notificationsEnabled) return;
  
  sendNotification({
    title: `@${agentId} failed`,
    body: error || `Task failed in #${channelName}`,
  });
}

export { notificationsEnabled };