import { useEffect } from 'react';
import {
  BackHandler,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface AboutViewProps {
  onClose: () => void;
}

export default function AboutView({ onClose }: AboutViewProps) {
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      }
    );

    return () => backHandler.remove();
  }, [onClose]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.aboutContainer}>
        <Text style={styles.title}>Secret Camera</Text>
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.description}>
          A secure camera application that lets you capture and store photos
          privately. All your photos are protected with biometric authentication
          and stored in a secure directory.
        </Text>
        <Text style={styles.subtitle}>Features:</Text>
        <Text style={styles.feature}>• Biometric authentication</Text>
        <Text style={styles.feature}>• Front and back camera support</Text>
        <Text style={styles.feature}>• Secure photo storage</Text>
        <Text style={styles.feature}>• Private gallery viewer</Text>
        <Text style={styles.feature}>• Direct photo sharing</Text>
        <Button title="Back" onPress={onClose} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    maxWidth: '100%',
  },
  aboutContainer: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  feature: {
    fontSize: 16,
    marginBottom: 8,
    paddingLeft: 10,
  },
  logo: {
    width: 100,
    height: 100,
    alignSelf: 'center',
    marginBottom: 15,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
});
