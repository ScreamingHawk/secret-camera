import { useEffect, useState } from 'react';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';

export const isEncryptedPhoto = (uri: string) =>
  uri.toLowerCase().endsWith('.scv');
export function usePhotoView(uri: string) {
  const encrypted = isEncryptedPhoto(uri);
  const [state, setState] = useState<{
    source: string;
    view: string | null;
    error: boolean;
  }>({ source: uri, view: encrypted ? null : uri, error: false });
  const current =
    state.source === uri
      ? state
      : { source: uri, view: encrypted ? null : uri, error: false };
  useEffect(() => {
    let active = true;
    let prepared: string | null = null;
    if (!encrypted) {
      setState({ source: uri, view: uri, error: false });
      return;
    }
    setState({ source: uri, view: null, error: false });
    PhotoVault.prepareEncryptedPhotoView(uri.split('/').pop()!)
      .then((value) => {
        prepared = value;
        if (active) setState({ source: uri, view: value, error: false });
        else void PhotoVault.releaseEncryptedPhotoView(value).catch(() => {});
      })
      .catch(() => {
        if (active) setState({ source: uri, view: null, error: true });
      });
    return () => {
      active = false;
      if (prepared)
        void PhotoVault.releaseEncryptedPhotoView(prepared).catch(() => {});
    };
  }, [uri, encrypted]);
  return { view: current.view, error: current.error, encrypted };
}
