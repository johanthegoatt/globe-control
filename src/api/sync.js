import { api } from "./client.js";

const LOCAL_CACHE_KEY = "globe_v5.settings_cache";

export async function syncProfileAndSettings({ profileId, localSettings, onSyncState }) {
  let remoteProfile = null;
  let remoteSettings = null;

  onSyncState("syncing");
  try {
    const data = await api.getProfile(profileId);
    remoteProfile = data.profile;
    remoteSettings = data.settings?.payload_json || null;
    onSyncState("synced");
  } catch {
    onSyncState("offline-fallback");
  }

  let resolved = localSettings;
  if (remoteSettings && remoteSettings.updatedAt && localSettings.updatedAt) {
    resolved = new Date(remoteSettings.updatedAt) > new Date(localSettings.updatedAt) ? remoteSettings : localSettings;
  } else if (remoteSettings) {
    resolved = remoteSettings;
  }

  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(resolved));
  } catch {
    // Ignore local cache issues.
  }

  if (resolved === localSettings) {
    try {
      onSyncState("syncing");
      await api.putSettings(profileId, localSettings);
      onSyncState("synced");
    } catch {
      onSyncState("offline-fallback");
    }
  }

  return { profile: remoteProfile, settings: resolved };
}

export function readLocalSettingsCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function persistSettingsRemote(profileId, settings, onSyncState) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore local cache issues.
  }

  try {
    onSyncState("syncing");
    await api.putSettings(profileId, settings);
    onSyncState("synced");
  } catch {
    onSyncState("offline-fallback");
  }
}
