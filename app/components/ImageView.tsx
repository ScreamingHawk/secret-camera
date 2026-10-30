import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef } from 'react';
import {
  AppState,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { usePhotoView } from '../utils/encryptedPhotoView';

interface ImageViewProps {
  uri: string;
  onClose: () => void;
  onDelete?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onShareState: (active: boolean) => void;
}

export default function ImageView({
  uri,
  onClose,
  onDelete,
  onNext,
  onPrevious,
  onShareState,
}: ImageViewProps) {
  const { view, error } = usePhotoView(uri);
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const sharing = useRef(false);
  const mounted = useRef(true);
  const handed = useRef(false);
  const shareError = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleShare = async () => {
    if (sharing.current) return;
    sharing.current = true;
    const source = uri;
    let exportUri: string | undefined;
    onShareState(true);
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) return;
      if (source.toLowerCase().endsWith('.scv')) {
        exportUri = await PhotoVault.prepareEncryptedPhotoShare(
          source.split('/').pop()!
        );
        if (!mounted.current || AppState.currentState !== 'active') {
          await PhotoVault.abandonOwnedShare(exportUri);
          return;
        }
        await PhotoVault.beginEncryptedPhotoShare(exportUri);
        if (!mounted.current || AppState.currentState !== 'active') {
          await PhotoVault.abandonOwnedShare(exportUri);
          return;
        }
        handed.current = true;
        await Sharing.shareAsync(exportUri, {
          dialogTitle: 'Share Image',
          mimeType: 'image/jpeg',
          UTI: 'public.jpeg',
        });
      } else if (mounted.current && AppState.currentState === 'active') {
        await Sharing.shareAsync(source, {
          dialogTitle: 'Share Image',
          mimeType: 'image/jpeg',
          UTI: 'public.jpeg',
        });
      }
    } catch {
      shareError.current = 'Unable to share image';
      if (mounted.current) console.error('Unable to share image');
    } finally {
      try {
        if (exportUri && handed.current) {
          try {
            await PhotoVault.finishEncryptedPhotoShare(exportUri);
          } catch {
            console.error('Unable to finalize encrypted photo share');
          }
        }
      } finally {
        handed.current = false;
        sharing.current = false;
        onShareState(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      {view ? (
        <Image
          source={{ uri: view }}
          style={[styles.image, { width: screenWidth, height: screenHeight }]}
          resizeMode="contain"
        />
      ) : (
        <View style={styles.message}>
          <Text style={{ color: 'white' }}>
            {error
              ? 'Photo unavailable. It may be damaged or the encryption key is missing.'
              : 'Unlocking photo…'}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.navTouch, { left: 0 }]}
        onPress={onPrevious}
      />
      <TouchableOpacity
        style={[styles.navTouch, { right: 0 }]}
        onPress={onNext}
      />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleShare}
          disabled={sharing.current}
          accessibilityLabel="Share image"
        >
          <Ionicons
            name="share-outline"
            size={32}
            color={sharing.current ? '#777' : 'white'}
          />
        </TouchableOpacity>
        <View style={styles.rightButtons}>
          {onDelete && (
            <TouchableOpacity style={styles.iconButton} onPress={onDelete}>
              <Ionicons name="trash-outline" size={32} color="white" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconButton} onPress={onClose}>
            <Ionicons name="close" size={32} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  image: {
    flex: 1,
  },
  message: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 40,
    zIndex: 2,
  },
  iconButton: {
    padding: 10,
  },
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navTouch: {
    position: 'absolute',
    top: 0,
    width: 100,
    height: '100%',
    zIndex: 1,
  },
});
