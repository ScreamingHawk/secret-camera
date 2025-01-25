import { Text, View, Button, StyleSheet } from "react-native";
import { useState } from "react";
import { useCameraPermissions } from "expo-camera";
import CameraView from "./components/CameraView";

export default function Index() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);

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

  return (
    <View style={styles.container}>
      <Button title="Open Camera" onPress={() => setShowCamera(true)} />
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
});
