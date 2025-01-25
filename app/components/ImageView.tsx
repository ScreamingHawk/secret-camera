import { View, Image, StyleSheet, TouchableOpacity, Share, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ImageViewProps {
  uri: string;
  onClose: () => void;
}

export default function ImageView({ uri, onClose }: ImageViewProps) {
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  const handleShare = async () => {
    try {
      await Share.share({
        url: uri // iOS
        // message: uri // Android
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
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={32} color="white" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={onClose}>
          <Ionicons name="close" size={32} color="white" />
        </TouchableOpacity>
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
  },
  iconButton: {
    padding: 10,
  },
}); 
