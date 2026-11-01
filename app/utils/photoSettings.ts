import * as FileSystem from 'expo-file-system';

const SETTINGS_URI = `${FileSystem.documentDirectory}.secret-camera-settings.json`;
const AUTOMATIC_ENCRYPTION = 'encryptAutomatically';

export async function loadEncryptAutomatically(): Promise<boolean> {
  if (!SETTINGS_URI.startsWith('file://')) return true;
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_URI);
    if (!info.exists) return true;
    const data: unknown = JSON.parse(
      await FileSystem.readAsStringAsync(SETTINGS_URI)
    );
    if (data && typeof data === 'object' && AUTOMATIC_ENCRYPTION in data) {
      return (data as Record<string, unknown>)[AUTOMATIC_ENCRYPTION] !== false;
    }
  } catch {
    // Missing or corrupt preference safely retains the protected default.
  }
  return true;
}

export async function saveEncryptAutomatically(
  enabled: boolean
): Promise<void> {
  if (!SETTINGS_URI.startsWith('file://'))
    throw new Error('Private settings storage unavailable');
  await FileSystem.writeAsStringAsync(
    SETTINGS_URI,
    JSON.stringify({ [AUTOMATIC_ENCRYPTION]: enabled })
  );
}
