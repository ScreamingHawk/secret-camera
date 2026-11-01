import { useEffect, useState } from 'react';
import {
  Alert,
  BackHandler,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { convertGallery } from '../utils/galleryConversion';
import {
  getPhotoOperationSnapshot,
  subscribePhotoOperation,
} from '../utils/photoOperation';

export default function SettingsView({
  encryptAutomatically,
  onEncryptAutomaticallyChange,
  onClose,
}: {
  encryptAutomatically: boolean;
  onEncryptAutomaticallyChange: (enabled: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [operation, setOperation] = useState(getPhotoOperationSnapshot());
  const [saving, setSaving] = useState(false);
  useEffect(() => subscribePhotoOperation(setOperation), []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (operation.running || saving) return true;
      onClose();
      return true;
    });
    return () => listener.remove();
  }, [operation.running, saving, onClose]);

  async function setAutomatic(enabled: boolean) {
    if (operation.running || saving) return;
    setSaving(true);
    try {
      await onEncryptAutomaticallyChange(enabled);
    } catch {
      Alert.alert(
        'Settings not saved',
        'The encryption preference could not be saved. The previous setting remains active.'
      );
    } finally {
      setSaving(false);
    }
  }

  function encryptAll() {
    if (operation.running) return;
    void convertGallery('encrypt').catch(() => {
      Alert.alert(
        'Encryption incomplete',
        'Photos that could not be encrypted remain unchanged. Check vault availability and retry.'
      );
    });
  }

  function confirmDecrypt() {
    if (operation.running) return;
    Alert.alert(
      'Decrypt all photos?',
      'Decrypted photos remain in this app’s private gallery but are unencrypted at rest. Anyone with access to this app’s private files could read them. This does not change Encrypt automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decrypt all photos',
          style: 'destructive',
          onPress: () => {
            void convertGallery('decrypt').catch(() => {
              Alert.alert(
                'Decryption incomplete',
                'Photos that could not be verified remain encrypted. Retry is safe.'
              );
            });
          },
        },
      ]
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onClose}
          disabled={operation.running || saving}
          style={styles.close}
        >
          <Text style={styles.closeText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.labelColumn}>
            <Text style={styles.label}>Encrypt automatically</Text>
            <Text style={styles.description}>
              Encrypt new camera photos before saving.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Encrypt automatically"
            value={encryptAutomatically}
            onValueChange={(value) => void setAutomatic(value)}
            disabled={operation.running || saving}
          />
        </View>
        {!encryptAutomatically && (
          <Text style={styles.warning}>
            New photos are stored unencrypted at rest in app-private storage.
          </Text>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Gallery encryption</Text>
        <Text style={styles.description}>
          Bulk actions affect existing photos only and do not change the
          automatic setting.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={encryptAll}
          disabled={operation.running || saving}
          style={[
            styles.button,
            (operation.running || saving) && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>Encrypt all photos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={confirmDecrypt}
          disabled={operation.running || saving}
          style={[
            styles.button,
            styles.decryptButton,
            (operation.running || saving) && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>Decrypt all photos</Text>
        </TouchableOpacity>
        <Text style={styles.warning}>
          Decrypted photos are unencrypted at rest, even though they remain in
          the app-private gallery.
        </Text>
      </View>
      {operation.progress || operation.result ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {operation.progress || operation.result}
        </Text>
      ) : null}
      {operation.running ? (
        <Text style={styles.status}>
          Keep the app open until this operation finishes. Back navigation is
          disabled.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16, backgroundColor: '#F5F6F7' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  close: { paddingVertical: 10, paddingRight: 14 },
  closeText: { color: '#245B91', fontSize: 16 },
  title: { color: '#2C3E50', fontSize: 24, fontWeight: '700' },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  labelColumn: { flex: 1 },
  label: { color: '#263746', fontSize: 16, fontWeight: '600' },
  description: { color: '#4B5D6B', fontSize: 14, lineHeight: 19 },
  warning: { color: '#7B341E', fontSize: 13, lineHeight: 18 },
  button: {
    minHeight: 46,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#3978B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  decryptButton: { backgroundColor: '#9B3D35' },
  buttonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  disabled: { opacity: 0.55 },
  status: {
    color: '#34495E',
    paddingVertical: 6,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
