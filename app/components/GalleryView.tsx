import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { APP_DIRECTORY } from '../constants';
import { usePhotoView } from '../utils/encryptedPhotoView';
import {
  getPendingMigration,
  runLegacyMigration,
} from '../utils/photoMigration';
import ImageView from './ImageView';

interface GalleryViewProps {
  onClose: () => void;
  onShareState: (active: boolean) => void;
}

export default function GalleryView({
  onClose,
  onShareState,
}: GalleryViewProps) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [migration, setMigration] = useState<
    'idle' | 'running' | 'success' | 'partial' | 'error'
  >('idle');
  const [migrationMessage, setMigrationMessage] = useState('');
  const migrationLock = useRef(false);
  const migrationRunning = useRef(false);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  async function handleMigration() {
    if (migrationLock.current) return;
    migrationLock.current = true;
    migrationRunning.current = true;
    setMigration('running');
    setMigrationMessage(
      'Encrypting existing photos. Originals are replaced only after verification.'
    );
    try {
      const result = await runLegacyMigration();
      if (!mounted.current) return;
      await loadPhotos();
      if (!mounted.current) return;
      setMigration(result.failed ? 'partial' : 'success');
      setMigrationMessage(
        result.failed
          ? `Encrypted ${result.migrated}; ${result.remaining} remain. Original files are retained when verification fails.`
          : result.migrated
            ? `Encrypted ${result.migrated} photos.`
            : 'No legacy photos found.'
      );
    } catch {
      if (mounted.current) {
        setMigration('error');
        setMigrationMessage(
          'Could not encrypt photos. Originals have been retained; check vault availability and retry.'
        );
      }
    } finally {
      migrationLock.current = false;
      migrationRunning.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (getPendingMigration()) void handleMigration();
    else void loadPhotos();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (migrationRunning.current) return true;
        if (selectedPhoto) {
          setSelectedPhoto(null);
        } else {
          onClose();
        }
        return true;
      }
    );

    return () => backHandler.remove();
  }, [selectedPhoto, onClose]);

  async function loadPhotos() {
    try {
      const files = await FileSystem.readDirectoryAsync(
        APP_DIRECTORY.SECRET_CAMERA
      );
      const photoUris = files.map(
        (filename) => `${APP_DIRECTORY.SECRET_CAMERA}/${filename}`
      );
      if (mounted.current) setPhotos(photoUris.reverse());
    } catch (error) {
      console.error('Unable to load gallery');
    }
  }

  async function handleDeleteImage(uri: string) {
    try {
      // Delete the file
      if (migrationRunning.current) return;
      await PhotoVault.deleteGalleryPhoto(uri.split('/').pop()!);

      // Update the photos state
      const newPhotos = photos.filter((photo) => photo !== uri);
      setPhotos(newPhotos);

      // Handle navigation to next/previous photo
      if (selectedPhoto === uri) {
        const currentIndex = photos.indexOf(uri);
        if (newPhotos.length === 0) {
          // No more photos, close the image view
          setSelectedPhoto(null);
        } else if (currentIndex === photos.length - 1) {
          // If we deleted the last photo, show the new last photo
          setSelectedPhoto(newPhotos[newPhotos.length - 1]);
        } else {
          // Show the next photo
          setSelectedPhoto(newPhotos[currentIndex]);
        }
      }
    } catch (error) {
      console.error('Unable to delete photo');
    }
  }

  const numColumns = 3;
  const screenWidth = Dimensions.get('window').width;
  const imageSize = screenWidth / numColumns - 4;

  if (selectedPhoto) {
    const currentIndex = photos.indexOf(selectedPhoto);
    return (
      <ImageView
        uri={selectedPhoto}
        onClose={() => setSelectedPhoto(null)}
        onDelete={() => handleDeleteImage(selectedPhoto)}
        onShareState={onShareState}
        onNext={() => {
          if (currentIndex < photos.length - 1) {
            setSelectedPhoto(photos[currentIndex + 1]);
          }
        }}
        onPrevious={() => {
          if (currentIndex > 0) {
            setSelectedPhoto(photos[currentIndex - 1]);
          }
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        disabled={migration === 'running'}
      >
        <Ionicons name="close" size={32} color="black" />
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Encrypt existing photos"
        onPress={handleMigration}
        disabled={migration === 'running'}
        style={styles.migrateButton}
      >
        <Text>
          {migration === 'running' ? 'Encrypting…' : 'Encrypt existing photos'}
        </Text>
      </TouchableOpacity>
      {!!migrationMessage && (
        <Text accessibilityLiveRegion="polite" style={styles.migrationMessage}>
          {migrationMessage}
        </Text>
      )}

      <FlatList
        data={photos}
        numColumns={numColumns}
        renderItem={({ item }) => (
          <GalleryItem
            item={item}
            imageSize={imageSize}
            onSelect={(uri) => {
              if (!migrationRunning.current) setSelectedPhoto(uri);
            }}
          />
        )}
        keyExtractor={(item) => item}
      />
    </View>
  );
}

function GalleryItem({
  item,
  imageSize,
  onSelect,
}: {
  item: string;
  imageSize: number;
  onSelect: (uri: string) => void;
}) {
  const { view, error } = usePhotoView(item);
  return (
    <TouchableOpacity
      style={styles.imageContainer}
      onPress={() => onSelect(item)}
    >
      {view ? (
        <Image
          source={{ uri: view }}
          style={[styles.image, { width: imageSize, height: imageSize }]}
        />
      ) : (
        <View
          style={[
            styles.image,
            styles.unavailable,
            { width: imageSize, height: imageSize },
          ]}
        >
          <Ionicons
            name={error ? 'alert-circle-outline' : 'lock-closed-outline'}
            size={24}
            color="#555"
          />
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  closeButton: {
    padding: 15,
    alignSelf: 'flex-end',
  },
  migrateButton: {
    padding: 12,
    alignSelf: 'center',
    backgroundColor: '#eee',
    borderRadius: 8,
  },
  migrationMessage: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    textAlign: 'center',
  },
  imageContainer: {
    padding: 2,
  },
  image: {
    borderRadius: 8,
  },
  unavailable: {
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
