import { useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Button,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AboutView from './components/AboutView';
import CameraView from './components/CameraView';
import GalleryView from './components/GalleryView';
import SettingsView from './components/SettingsView';
import { isPhotoOperationRunning } from './utils/photoOperation';
import {
  loadEncryptAutomatically,
  saveEncryptAutomatically,
} from './utils/photoSettings';
import { authenticateUser } from './utils/security';

export default function Index() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [encryptAutomatically, setEncryptAutomatically] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const authInFlight = useRef(false);
  const mounted = useRef(true);
  const appActive = useRef(AppState.currentState === 'active');
  const sharing = useRef(false);
  const resumePending = useRef(false);
  const authGeneration = useRef(0);
  const [privacyCovered, setPrivacyCovered] = useState(false);

  const authenticate = async () => {
    if (authInFlight.current) return;
    authInFlight.current = true;
    const generation = authGeneration.current;
    try {
      const success = await authenticateUser();
      if (
        mounted.current &&
        generation === authGeneration.current &&
        success &&
        appActive.current
      ) {
        setIsAuthenticated(true);
        setPrivacyCovered(false);
      }
    } catch (error) {
      console.error('Authentication failed:', error);
    } finally {
      authInFlight.current = false;
      if (
        mounted.current &&
        resumePending.current &&
        appActive.current &&
        !sharing.current
      ) {
        resumePending.current = false;
        void authenticate();
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void authenticate();
    void loadEncryptAutomatically().then((enabled) => {
      if (mounted.current) {
        setEncryptAutomatically(enabled);
        setSettingsReady(true);
      }
    });
    const subscription = AppState.addEventListener('change', (state) => {
      const wasActive = appActive.current;
      // Ignore the biometric sheet's inactive→active transition. Android may
      // go directly to background, which remains a real relock boundary.
      if (state === 'inactive') return;
      appActive.current = state === 'active';
      if (state === 'background') {
        authGeneration.current += 1;
        resumePending.current = true;
        if (sharing.current) setPrivacyCovered(true);
        else {
          setIsAuthenticated(false);
          setPrivacyCovered(false);
        }
      } else if (!wasActive && !sharing.current) {
        if (authInFlight.current) resumePending.current = true;
        else {
          resumePending.current = false;
          void authenticate();
        }
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (isPhotoOperationRunning()) return true;
      if (showCamera) {
        setShowCamera(false);
        return true;
      }
      if (showGallery) {
        setShowGallery(false);
        return true;
      }
      if (showAbout) {
        setShowAbout(false);
        return true;
      }
      if (showSettings) {
        setShowSettings(false);
        return true;
      }
      // Exit app when on home screen
      BackHandler.exitApp();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [showCamera, showGallery, showAbout, showSettings]);

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          Please authenticate to access the app
        </Text>
        <Button onPress={() => void authenticate()} title="Authenticate" />
      </View>
    );
  }

  if (!settingsReady) {
    return <View style={styles.container} />;
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
    return (
      <CameraView
        encryptAutomatically={encryptAutomatically}
        onClose={() => setShowCamera(false)}
      />
    );
  }

  if (showSettings) {
    return (
      <SettingsView
        encryptAutomatically={encryptAutomatically}
        onEncryptAutomaticallyChange={async (enabled) => {
          await saveEncryptAutomatically(enabled);
          setEncryptAutomatically(enabled);
        }}
        onClose={() => setShowSettings(false)}
      />
    );
  }

  if (showGallery) {
    const onShareState = (active: boolean) => {
      sharing.current = active;
      if (!active && resumePending.current) {
        setPrivacyCovered(false);
        setIsAuthenticated(false);
        if (appActive.current) {
          resumePending.current = false;
          if (authInFlight.current) resumePending.current = true;
          else void authenticate();
        }
      }
    };
    return (
      <View style={styles.privacyCover}>
        <GalleryView
          onClose={() => setShowGallery(false)}
          onShareState={onShareState}
        />
        {privacyCovered && (
          <View pointerEvents="auto" style={styles.coverOverlay}>
            <Text style={styles.message}>Private content hidden</Text>
          </View>
        )}
      </View>
    );
  }

  if (showAbout) {
    return <AboutView onClose={() => setShowAbout(false)} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Secret Camera</Text>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.button}
            disabled={isPhotoOperationRunning()}
            onPress={() => setShowCamera(true)}
          >
            <Text style={styles.buttonText}>Open Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            disabled={isPhotoOperationRunning()}
            onPress={() => setShowGallery(true)}
          >
            <Text style={styles.buttonText}>View Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            disabled={isPhotoOperationRunning()}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.buttonText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            onPress={() => setShowAbout(true)}
          >
            <Text style={styles.buttonText}>About</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F6F7',
  },
  privacyCover: { flex: 1 },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F5F6F7',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 40,
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 20,
    fontSize: 16,
    color: '#34495E',
  },
  buttonContainer: {
    width: '80%',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    gap: 15, // Spacing between buttons
  },
  button: {
    backgroundColor: '#4A90E2',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 40,
  },
});
