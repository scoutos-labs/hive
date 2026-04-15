// Tauri notifications (desktop only)

type NotificationPlugin = typeof import('@tauri-apps/plugin-notification');

let notificationsEnabled = false;

async function loadNotificationPlugin(): Promise<NotificationPlugin | null> {
  // The web build should not require Tauri packages to be present, so the
  // desktop plugin is loaded lazily and treated as optional.
  try {
    return await import('@tauri-apps/plugin-notification');
  } catch {
    return null;
  }
}

export async function initNotifications() {
  try {
    const plugin = await loadNotificationPlugin();
    if (!plugin) {
      notificationsEnabled = false;
      return;
    }

    const granted = await plugin.isPermissionGranted();
    if (!granted) {
      const permission = await plugin.requestPermission();
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

  void loadNotificationPlugin().then((plugin) => {
    plugin?.sendNotification({
      title: `@${agentId} completed`,
      body: `Task finished in #${channelName}`,
    });
  });
}

export function notifyAgentFailed(agentId: string, channelName: string, error?: string) {
  if (!notificationsEnabled) return;

  void loadNotificationPlugin().then((plugin) => {
    plugin?.sendNotification({
      title: `@${agentId} failed`,
      body: error || `Task failed in #${channelName}`,
    });
  });
}

export { notificationsEnabled };
