import { Text, View, Button, StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';
import { useCameraPermissions } from 'expo-camera';
import CameraView from './components/CameraView';
import GalleryView from './components/GalleryView';
import { authenticateUser } from './utils/security';

export default function Index() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    authenticateUser().then(setIsAuthenticated);
  }, []);

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          Please authenticate to access the app
        </Text>
        <Button
          onPress={() => authenticateUser().then(setIsAuthenticated)}
          title="Authenticate"
        />
      </View>
    );
  }

  if (!permission) {
    // Camera permissions are still loading
    return <View />;
  }

  if (!permission.granted) {
    // Camera permissions are not granted yet
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          We need your permission to show the camera
        </Text>
        <Button onPress={requestPermission} title="Grant Permission" />
      </View>
    );
  }

  if (showCamera) {
    return <CameraView onClose={() => setShowCamera(false)} />;
  }

  if (showGallery) {
    return <GalleryView onClose={() => setShowGallery(false)} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.buttonContainer}>
        <Button title="Open Camera" onPress={() => setShowCamera(true)} />
        <View style={styles.buttonSpacing} />
        <Button title="View Gallery" onPress={() => setShowGallery(true)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
  },
  buttonContainer: {
    alignItems: 'center',
  },
  buttonSpacing: {
    height: 20,
  },
});
