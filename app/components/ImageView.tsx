import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import {
  Dimensions,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface ImageViewProps {
  uri: string;
  onClose: () => void;
  onDelete?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

export default function ImageView({
  uri,
  onClose,
  onDelete,
  onNext,
  onPrevious,
}: ImageViewProps) {
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  const handleShare = async () => {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        console.error('Sharing is not available on this platform');
        return;
      }

      await Sharing.shareAsync(uri, {
        dialogTitle: 'Share Image',
        mimeType: 'image/jpeg',
        UTI: 'public.jpeg',
      });
    } catch (error) {
      console.error('Error sharing image:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={{ uri }}
        style={[styles.image, { width: screenWidth, height: screenHeight }]}
        resizeMode="contain"
      />

      <TouchableOpacity
        style={[styles.navTouch, { left: 0 }]}
        onPress={onPrevious}
      />
      <TouchableOpacity
        style={[styles.navTouch, { right: 0 }]}
        onPress={onNext}
      />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={32} color="white" />
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
