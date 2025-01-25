import * as FileSystem from 'expo-file-system';

export const APP_DIRECTORY = {
  SECRET_CAMERA: `${FileSystem.documentDirectory}.secret-camera`,
} as const;

export default {
  APP_DIRECTORY,
};
