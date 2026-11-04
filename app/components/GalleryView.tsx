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
import { isPhotoOperationRunning } from '../utils/photoOperation';
import ImageView from './ImageView';

interface GalleryViewProps {
  onClose: () => void;
  onShareState: (active: boolean) => void;
  refreshKey?: number;
  importNotice?: string;
  onRetryImports?: () => void;
  onImportPhotos?: () => void;
}

export default function GalleryView({
  onClose,
  onShareState,
  refreshKey = 0,
  importNotice = '',
  onRetryImports,
  onImportPhotos,
}: GalleryViewProps) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  useEffect(() => {
    mounted.current = true;
    void loadPhotos();
    return () => {
      mounted.current = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isPhotoOperationRunning()) return true;
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
      const photoUris = files
        .filter((filename) => /\.(?:jpe?g|png|scv)$/i.test(filename))
        .map((filename) => `${APP_DIRECTORY.SECRET_CAMERA}/${filename}`);
      if (mounted.current) setPhotos(photoUris.reverse());
    } catch (error) {
      console.error('Unable to load gallery');
    }
  }

  async function handleDeleteImage(uri: string) {
    try {
      // Delete the file
      if (isPhotoOperationRunning()) return;
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
        disabled={isPhotoOperationRunning()}
      >
        <Ionicons name="close" size={32} color="black" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.importButton}
        onPress={onImportPhotos}
        disabled={!onImportPhotos || isPhotoOperationRunning()}
      >
        <Text style={styles.importButtonText}>Import photos</Text>
      </TouchableOpacity>

      {importNotice !== '' && (
        <View style={styles.importNotice}>
          <Text>{importNotice}</Text>
          <TouchableOpacity onPress={onRetryImports} disabled={!onRetryImports}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={photos}
        numColumns={numColumns}
        renderItem={({ item }) => (
          <GalleryItem
            item={item}
            imageSize={imageSize}
            onSelect={(uri) => {
              if (!isPhotoOperationRunning()) setSelectedPhoto(uri);
            }}
          />
        )}
        keyExtractor={(item) => item}
        initialNumToRender={12}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews
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
  imageContainer: {
    padding: 2,
  },
  importNotice: { paddingHorizontal: 16, paddingBottom: 8 },
  importButton: {
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    backgroundColor: '#4A90E2',
    borderRadius: 6,
  },
  importButtonText: { color: 'white', fontWeight: '600' },

  retryText: { color: '#2466a2', fontWeight: '600', paddingTop: 4 },
  image: {
    borderRadius: 8,
  },
  unavailable: {
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
