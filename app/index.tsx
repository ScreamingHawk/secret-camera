import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Button,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';
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
import { importPendingSharedImages } from './utils/sharedImageImport';

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
  const [pendingRefresh, setPendingRefresh] = useState(0);
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [importNotice, setImportNotice] = useState('');
  const importBusy = useRef(false);
  const importAgain = useRef(false);
  const pickerInFlight = useRef(false);
  const [pickerNotice, setPickerNotice] = useState('');

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
    const pendingSubscription = PhotoVault.addListener(
      'pendingImageSharesChanged',
      (event) => {
        if (event.failed) {
          setImportNotice(
            'Secret Camera could not read or stage the share. It accepts valid JPEGs only (32 MiB each; pending storage 20 images/64 MiB). The sender original was not changed; check the format and size, then retry.'
          );
        }
        setPendingRefresh((value) => value + 1);
      }
    );
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
      if (state === 'active') {
        setPendingRefresh((value) => value + 1);
        if (!wasActive && !sharing.current) {
          setSettingsReady(false);
          void loadEncryptAutomatically().then((enabled) => {
            if (!mounted.current || !appActive.current) return;
            setEncryptAutomatically(enabled);
            setSettingsReady(true);
          });
        }
      }
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
      pendingSubscription.remove();
      subscription.remove();
    };
  }, []);

  const choosePhotos = async () => {
    if (pickerInFlight.current || isPhotoOperationRunning()) return;
    const authGenerationBeforePicker = authGeneration.current;
    pickerInFlight.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
        exif: false,
      });
      if (result.canceled || !result.assets?.length) return;
      let stageFailures = 0;
      for (const asset of result.assets) {
        try {
          await PhotoVault.stagePickedImage(asset.uri);
        } catch {
          stageFailures += 1;
        }
      }
      setPickerNotice(
        stageFailures
          ? `${result.assets.length - stageFailures} staged; ${stageFailures} failed. Supported formats are valid JPEG images only. Original photos remain unchanged in existing storage.`
          : 'Selected JPEGs are staged privately. Original photos remain unchanged in existing storage.'
      );
      setImportNotice(
        stageFailures
          ? `${result.assets.length - stageFailures} selected JPEG${result.assets.length - stageFailures === 1 ? '' : 's'} staged; ${stageFailures} failed. Original photos remain unchanged in existing storage.`
          : ''
      );
      // Block normal pending-share processing until every picker asset has either staged or failed.
      if (
        appActive.current &&
        authGenerationBeforePicker === authGeneration.current
      ) {
        setIsAuthenticated(false);
        setSettingsReady(false);
        setPrivacyCovered(false);
        resumePending.current = false;
        const currentSetting = await loadEncryptAutomatically();
        if (mounted.current) {
          setEncryptAutomatically(currentSetting);
          setSettingsReady(true);
          void authenticate();
        }
      } else if (appActive.current) {
        setPendingRefresh((value) => value + 1);
      }
    } catch {
      setPickerNotice(
        'Selected photos could not be staged. Originals remain unchanged.'
      );
    } finally {
      pickerInFlight.current = false;
      if (
        importAgain.current &&
        mounted.current &&
        appActive.current &&
        isAuthenticated
      ) {
        importAgain.current = false;
        setPendingRefresh((value) => value + 1);
      }
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !settingsReady || !appActive.current) return;
    if (pickerInFlight.current) {
      importAgain.current = true;
      return;
    }
    if (importBusy.current) {
      importAgain.current = true;
      return;
    }
    importBusy.current = true;
    void importPendingSharedImages(encryptAutomatically)
      .then(({ imported, failed, stageFailure }) => {
        if (!mounted.current) return;
        if (stageFailure || failed || imported.length) {
          setImportNotice(
            stageFailure
              ? 'Secret Camera could not read or stage the share. It accepts valid JPEGs only (32 MiB each; pending storage 20 images/64 MiB). The sender original was not changed; check the format and size, then retry.'
              : failed
                ? `${failed} shared image${failed === 1 ? '' : 's'} could not be imported; the staged private copy remains available to retry.`
                : ''
          );
        }
        if (imported.length) {
          setGalleryRefresh((value) => value + 1);
          setShowGallery(true);
        }
      })
      .catch(() => {
        if (mounted.current)
          setImportNotice(
            'Shared images could not be checked. Retry when Secret Camera is active.'
          );
      })
      .finally(() => {
        importBusy.current = false;
        if (importAgain.current && mounted.current) {
          importAgain.current = false;
          setPendingRefresh((value) => value + 1);
        }
      });
  }, [isAuthenticated, settingsReady, encryptAutomatically, pendingRefresh]);

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
          refreshKey={galleryRefresh}
          importNotice={
            pickerNotice && importNotice
              ? `${pickerNotice} ${importNotice}`
              : pickerNotice || importNotice
          }
          onRetryImports={() => setPendingRefresh((value) => value + 1)}
          onImportPhotos={
            Platform.OS === 'android'
              ? () => {
                  setShowGallery(false);
                  void choosePhotos();
                }
              : undefined
          }
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
          {importNotice !== '' && (
            <View>
              <Text style={styles.message}>{importNotice}</Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => setPendingRefresh((value) => value + 1)}
              >
                <Text style={styles.buttonText}>Retry import</Text>
              </TouchableOpacity>
            </View>
          )}
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
          {Platform.OS === 'android' && (
            <>
              <TouchableOpacity
                style={styles.button}
                disabled={isPhotoOperationRunning() || pickerInFlight.current}
                onPress={() => void choosePhotos()}
              >
                <Text style={styles.buttonText}>Import JPEG Photos</Text>
              </TouchableOpacity>
              <Text style={styles.message}>
                Only valid JPEG images up to 32 MiB each are accepted. Originals
                remain unchanged in existing storage.
              </Text>
            </>
          )}
          {pickerNotice !== '' && (
            <Text style={styles.message}>{pickerNotice}</Text>
          )}
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
