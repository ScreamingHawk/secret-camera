import { Ionicons } from '@expo/vector-icons';
import { CameraType, CameraView as ExpoCameraView } from 'expo-camera';

import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { savePhoto, type PhotoSaveStage } from '../utils/security';

interface CameraViewProps {
  onClose: () => void;
}

type CaptureStatus =
  | PhotoSaveStage
  | 'VAULT_PREPARATION_PENDING'
  | 'VAULT_PREPARATION_FAILED'
  | 'CAMERA_CAPTURE_EMPTY'
  | 'CAMERA_CAPTURE_FAILED_READY'
  | 'CAMERA_CAPTURE_FAILED_NOT_READY'
  | 'SAVE_FAILED'
  | 'SOURCE_CLEANUP_INCOMPLETE';

const DISPLAY_CODES: Record<CaptureStatus, string> = {
  SAVE_URI_INVALID: 'S1_URI',
  SAVE_CACHE_UNAVAILABLE: 'S2_CACHE',
  SAVE_CACHE_LOOKUP_FAILED: 'S3_LOOKUP',
  SAVE_DIRECTORY_FAILED: 'S4_DIR',
  SAVE_COPY_FAILED: 'S5_COPY',
  SAVE_ENCRYPTION_FAILED: 'S6_ENCRYPT',
  VAULT_PREPARATION_PENDING: 'V1_WAIT',
  VAULT_PREPARATION_FAILED: 'V2_VAULT',
  CAMERA_CAPTURE_EMPTY: 'C1_EMPTY',
  CAMERA_CAPTURE_FAILED_READY: 'C2_READY',
  CAMERA_CAPTURE_FAILED_NOT_READY: 'C3_CAMERA',
  SAVE_FAILED: 'S0_SAVE',
  SOURCE_CLEANUP_INCOMPLETE: 'S7_CLEANUP',
};

export default function CameraView({ onClose }: CameraViewProps) {
  const [facing, setFacing] = useState<CameraType>('back');
  const cameraRef = useRef<ExpoCameraView>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const readyRef = useRef(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(
    null
  );
  const cameraReadyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await PhotoVault.prepareCaptureVault();
        readyRef.current = true;
      } catch {
        if (mountedRef.current) setCaptureStatus('VAULT_PREPARATION_FAILED');
      }
    })();
  }, []);

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

  function toggleCameraFacing() {
    cameraReadyRef.current = false;
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }

  async function takePicture() {
    if (savingRef.current || !readyRef.current || !cameraRef.current) {
      if (!readyRef.current && mountedRef.current)
        setCaptureStatus((current) =>
          current === 'VAULT_PREPARATION_FAILED'
            ? current
            : 'VAULT_PREPARATION_PENDING'
        );
      return;
    }
    savingRef.current = true;
    setCaptureStatus(null);
    let phase: 'camera' | 'save' = 'camera';
    try {
      const photo = await cameraRef.current.takePictureAsync();
      if (!photo) {
        if (mountedRef.current) setCaptureStatus('CAMERA_CAPTURE_EMPTY');
        return;
      }
      phase = 'save';
      const result = await savePhoto(photo.uri);
      if (!result.sourceRemoved && mountedRef.current)
        setCaptureStatus('SOURCE_CLEANUP_INCOMPLETE');
    } catch (error) {
      if (mountedRef.current) {
        const stages: PhotoSaveStage[] = [
          'SAVE_URI_INVALID',
          'SAVE_CACHE_UNAVAILABLE',
          'SAVE_CACHE_LOOKUP_FAILED',
          'SAVE_DIRECTORY_FAILED',
          'SAVE_COPY_FAILED',
          'SAVE_ENCRYPTION_FAILED',
        ];
        const stage =
          error && typeof error === 'object' && 'stage' in error
            ? (error as { stage?: unknown }).stage
            : undefined;
        setCaptureStatus(
          phase === 'camera'
            ? cameraReadyRef.current
              ? 'CAMERA_CAPTURE_FAILED_READY'
              : 'CAMERA_CAPTURE_FAILED_NOT_READY'
            : (stages.find((code) => code === stage) ?? 'SAVE_FAILED')
        );
      }
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <ExpoCameraView
      ref={cameraRef}
      style={styles.camera}
      facing={facing}
      onCameraReady={() => {
        cameraReadyRef.current = true;
      }}
    >
      <View style={styles.buttonContainer}>
        {captureStatus && (
          <Text style={styles.error}>
            {captureStatus === 'SOURCE_CLEANUP_INCOMPLETE'
              ? 'Photo saved, but cleanup was incomplete'
              : `Photo could not be saved\n${DISPLAY_CODES[captureStatus]}`}
          </Text>
        )}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={toggleCameraFacing}
        >
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
  error: {
    position: 'absolute',
    bottom: 90,
    left: 0,
    right: 0,
    color: 'white',
    backgroundColor: '#900',
    padding: 8,
    textAlign: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
});
