import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useEffect, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { APP_DIRECTORY } from '../constants';
import ImageView from './ImageView';

interface GalleryViewProps {
  onClose: () => void;
}

export default function GalleryView({ onClose }: GalleryViewProps) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  useEffect(() => {
    loadPhotos();
  }, []);

  async function loadPhotos() {
    try {
      console.log(
        'Loading photos from directory:',
        APP_DIRECTORY.SECRET_CAMERA
      );
      const files = await FileSystem.readDirectoryAsync(
        APP_DIRECTORY.SECRET_CAMERA
      );
      const photoUris = files.map(
        (filename) => `${APP_DIRECTORY.SECRET_CAMERA}/${filename}`
      );
      setPhotos(photoUris.reverse());
    } catch (error) {
      console.error('Error loading photos:', error);
    }
  }

  const numColumns = 3;
  const screenWidth = Dimensions.get('window').width;
  const imageSize = screenWidth / numColumns - 4;

  if (selectedPhoto) {
    return (
      <ImageView uri={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
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
    return (
      <TouchableOpacity
        style={styles.imageContainer}
        onPress={() => onSelect(item)}
      >
        <Image
          source={{ uri: item }}
          style={[styles.image, { width: imageSize, height: imageSize }]}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Ionicons name="close" size={32} color="black" />
      </TouchableOpacity>

      <FlatList
        data={photos}
        numColumns={numColumns}
        renderItem={({ item }) => (
          <GalleryItem
            item={item}
            imageSize={imageSize}
            onSelect={setSelectedPhoto}
          />
        )}
        keyExtractor={(item) => item}
      />
    </View>
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
  image: {
    borderRadius: 8,
  },
});
