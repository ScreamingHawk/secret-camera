import { View, TouchableOpacity, StyleSheet } from "react-native";
import { CameraView as ExpoCameraView, CameraType } from "expo-camera";
import { useState, useRef, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from 'expo-file-system';

interface CameraViewProps {
  onClose: () => void;
}

export default function CameraView({ onClose }: CameraViewProps) {
  const [facing, setFacing] = useState<CameraType>('back');
  const cameraRef = useRef<ExpoCameraView>(null);
  const secretDir = `${FileSystem.documentDirectory}.secret-camera`;

  useEffect(() => {
    (async () => {
      const dirInfo = await FileSystem.getInfoAsync(secretDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(secretDir, { intermediates: true });
      }
    })();
  }, [secretDir]);

  function toggleCameraFacing() {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  }

  async function takePicture() {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync();
      if (!photo) {
        console.error('No photo captured');
        return;
      }
      
      const filename = `photo_${Date.now()}.jpg`;
      const destination = `${secretDir}/${filename}`;
      
      try {
        await FileSystem.moveAsync({
          from: photo.uri,
          to: destination
        });
        console.log('Photo saved to:', destination);
      } catch (error) {
        console.error('Error saving photo:', error);
      }
    }
  }

  return (
    <ExpoCameraView 
      ref={cameraRef}
      style={styles.camera} 
      facing={facing}
    >
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.iconButton} onPress={toggleCameraFacing}>
          <Ionicons name="camera-reverse" size={32} color="white" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconButton} onPress={onClose}>
          <Ionicons name="close" size={32} color="white" />
        </TouchableOpacity>
      </View>
    </ExpoCameraView>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    margin: 20,
    marginBottom: 40,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  iconButton: {
    padding: 15,
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
}); 
