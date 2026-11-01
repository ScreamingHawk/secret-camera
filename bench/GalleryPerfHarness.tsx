import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { APP_DIRECTORY } from '../app/constants';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

const GalleryPerfBaseline = require('./generated/GalleryPerfBaseline').default;
const GalleryPerfCandidate =
  require('./generated/GalleryPerfCandidate').default;

const BUILD_SENTINEL = 'GALLERY_PERF_BUILD_SENTINEL_SC5XX';
const PHOTO_COUNT = 96;
const VIEW_CACHE = `${FileSystem.cacheDirectory}photo-vault-views/`;
const REPORT_PREFIX = `${FileSystem.documentDirectory}gallery-perf-`;
const SEED_MARKER = `${FileSystem.documentDirectory}gallery-perf-seed-complete.json`;
const JPEG_ASSET = require('./synthetic-gallery.jpg');
type Variant = 'baseline' | 'candidate' | 'seed';
type Visit = {
  firstVisibleImageMs: number;
  visibleViewportMs: number;
  cleanupMs: number;
  visibleTileCount: number;
  preparedCacheFilesAtViewport: number;
  preparedCacheBytesAtViewport: number;
  cacheFilesAfterCleanup: number;
};
type ActiveProbe = {
  visibleItems: (items: string[]) => void;
  imageLoaded: (name: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const leaf = (index: number) =>
  `perf-synthetic-${String(index).padStart(3, '0')}.scv`;
const expectedLeaves = new Set(
  Array.from({ length: PHOTO_COUNT }, (_, i) => leaf(i))
);

class HarnessFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function safeNativeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(code)
    ? code
    : null;
}

async function allGalleryEntries(): Promise<string[]> {
  try {
    return await FileSystem.readDirectoryAsync(APP_DIRECTORY.SECRET_CAMERA);
  } catch {
    throw new HarnessFailure('gallery_directory_unreadable');
  }
}

async function seedGallery(variant: Variant) {
  await FileSystem.makeDirectoryAsync(APP_DIRECTORY.SECRET_CAMERA, {
    intermediates: true,
  });
  const entries = await allGalleryEntries();
  const marker = await FileSystem.getInfoAsync(SEED_MARKER);
  if (variant !== 'seed' && !marker.exists) {
    throw new HarnessFailure('synthetic_seed_marker_missing');
  }
  if (marker.exists) {
    let markerData: {
      buildSentinel?: string;
      photoCount?: number;
      entries?: string[];
    };
    try {
      markerData = JSON.parse(await FileSystem.readAsStringAsync(SEED_MARKER));
    } catch {
      throw new HarnessFailure('synthetic_seed_marker_invalid');
    }
    if (
      markerData.buildSentinel !== BUILD_SENTINEL ||
      markerData.photoCount !== PHOTO_COUNT ||
      !Array.isArray(markerData.entries) ||
      markerData.entries.length !== PHOTO_COUNT ||
      entries.length !== PHOTO_COUNT ||
      entries.some(
        (name) =>
          !expectedLeaves.has(name) || !markerData.entries!.includes(name)
      )
    ) {
      throw new HarnessFailure('nonempty_gallery_guard');
    }
    try {
      await PhotoVault.requireExistingKey();
    } catch {
      throw new HarnessFailure('existing_synthetic_gallery_key_unavailable');
    }
    return;
  }
  // A fresh, marker-free installation must have an empty gallery. Reject every preexisting
  // entry (including legacy JPEGs) before creating a vault key or writing any test files.
  if (entries.length !== 0) throw new HarnessFailure('nonempty_gallery_guard');
  await PhotoVault.initializeNewVault();

  const asset = Asset.fromModule(JPEG_ASSET);
  await asset.downloadAsync();
  if (!asset.localUri) throw new HarnessFailure('fixture_asset_unavailable');
  const source = `${FileSystem.documentDirectory}gallery-perf-source.jpg`;
  await FileSystem.copyAsync({ from: asset.localUri, to: source });
  try {
    for (let index = 0; index < PHOTO_COUNT; index += 1) {
      const encryptedStage = `${FileSystem.documentDirectory}gallery-perf-stage-${String(index).padStart(3, '0')}.scv`;
      const destination = `${APP_DIRECTORY.SECRET_CAMERA}/${leaf(index)}`;
      await PhotoVault.encryptFile(source, encryptedStage);
      await FileSystem.moveAsync({ from: encryptedStage, to: destination });
    }
    await FileSystem.writeAsStringAsync(
      SEED_MARKER,
      JSON.stringify({
        buildSentinel: BUILD_SENTINEL,
        photoCount: PHOTO_COUNT,
        entries: [...expectedLeaves],
      })
    );
  } catch (error) {
    const nativeCode = safeNativeErrorCode(error);
    throw new HarnessFailure(
      nativeCode
        ? `synthetic_photo_encryption_${nativeCode}`
        : 'synthetic_photo_encryption_failed'
    );
  } finally {
    await FileSystem.deleteAsync(source, { idempotent: true });
  }
}

async function viewCacheMetrics() {
  const directory = await FileSystem.getInfoAsync(VIEW_CACHE);
  if (!directory.exists) return { files: 0, bytes: 0 };
  if (!directory.isDirectory)
    throw new HarnessFailure('private_view_cache_not_directory');
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(VIEW_CACHE);
  } catch {
    throw new HarnessFailure('private_view_cache_unreadable');
  }
  if (names.some((name) => !/^view-[0-9a-f-]{36}\.jpg$/.test(name))) {
    throw new HarnessFailure('unexpected_private_view_cache_entry');
  }
  let bytes = 0;
  for (const name of names) {
    const info = await FileSystem.getInfoAsync(`${VIEW_CACHE}${name}`);
    if (info.exists && 'size' in info) bytes += info.size;
  }
  return { files: names.length, bytes };
}

async function waitForReleasedViews() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if ((await viewCacheMetrics()).files === 0) return;
    await sleep(100);
  }
  throw new HarnessFailure('private_view_cache_cleanup_timeout');
}

function measureVisit(
  variant: Variant,
  probe: MutableRefObject<ActiveProbe | null>,
  setMounted: (value: boolean) => void
): Promise<Visit> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const visible = new Set<string>();
    const loadedAt = new Map<string, number>();
    let firstVisibleImageMs: number | null = null;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const clearTimers = () => {
      clearTimeout(timeout);
      if (stableTimer) clearTimeout(stableTimer);
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimers();
      probe.current = null;
      (globalThis as any).__scGalleryPerf = null;
      setMounted(false);
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new HarnessFailure(`visible_image_timeout_${variant}`)),
      90000
    );

    const scheduleViewportFinish = () => {
      if (
        visible.size === 0 ||
        [...visible].some((name) => !loadedAt.has(name))
      )
        return;
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        if (
          finished ||
          visible.size === 0 ||
          [...visible].some((name) => !loadedAt.has(name))
        )
          return;
        // Capture usability time before filesystem stats, unmount, cache cleanup or sleeps.
        const viewportCompleteAt = performance.now();
        finished = true;
        clearTimers();
        probe.current = null;
        (globalThis as any).__scGalleryPerf = null;
        void (async () => {
          try {
            const cache = await viewCacheMetrics();
            const cleanupStarted = performance.now();
            setMounted(false);
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
            await waitForReleasedViews();
            const cleanupMs = Math.round(performance.now() - cleanupStarted);
            resolve({
              firstVisibleImageMs: Math.round(
                firstVisibleImageMs ?? viewportCompleteAt - started
              ),
              visibleViewportMs: Math.round(viewportCompleteAt - started),
              cleanupMs,
              visibleTileCount: visible.size,
              preparedCacheFilesAtViewport: cache.files,
              preparedCacheBytesAtViewport: cache.bytes,
              cacheFilesAfterCleanup: (await viewCacheMetrics()).files,
            });
          } catch (error) {
            setMounted(false);
            reject(
              error instanceof Error
                ? error
                : new HarnessFailure('visit_cleanup_failed')
            );
          }
        })();
      }, 150);
    };

    probe.current = {
      visibleItems(items) {
        const next = new Set(items);
        const changed =
          next.size !== visible.size ||
          [...next].some((item) => !visible.has(item));
        visible.clear();
        next.forEach((name) => visible.add(name));
        const loadedVisible = [...visible]
          .map((name) => loadedAt.get(name))
          .filter((time): time is number => time !== undefined);
        if (loadedVisible.length > 0) {
          firstVisibleImageMs = Math.min(...loadedVisible) - started;
        }
        if (changed) scheduleViewportFinish();
      },
      imageLoaded(name) {
        const loadedAtMs = performance.now();
        loadedAt.set(name, loadedAtMs);
        if (visible.has(name)) {
          firstVisibleImageMs = Math.min(
            firstVisibleImageMs ?? Number.POSITIVE_INFINITY,
            loadedAtMs - started
          );
          scheduleViewportFinish();
        }
        // Off-screen image events intentionally do not reset the viewport stability deadline.
      },
    };
    (globalThis as any).__scGalleryPerf = probe.current;
    setMounted(true);
  });
}

export default function GalleryPerfHarness() {
  const probe = useRef<ActiveProbe | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState('Selecting test variant');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    Linking.getInitialURL()
      .then((url) => {
        if (!active) return;
        const requested = url ? new URL(url).searchParams.get('variant') : null;
        setVariant(
          requested === 'candidate' || requested === 'seed'
            ? requested
            : 'baseline'
        );
      })
      .catch(() => {
        if (active) setVariant('baseline');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!variant) return;
    let active = true;
    (async () => {
      let stage = 'synthetic_seed';
      try {
        await seedGallery(variant);
        const photos = await allGalleryEntries();
        if (
          photos.length !== PHOTO_COUNT ||
          photos.some((name) => !expectedLeaves.has(name))
        ) {
          throw new HarnessFailure('synthetic_gallery_count_mismatch');
        }
        if (variant === 'seed') {
          await FileSystem.writeAsStringAsync(
            `${REPORT_PREFIX}seed.json`,
            JSON.stringify(
              {
                schema: 1,
                buildSentinel: BUILD_SENTINEL,
                variant: 'seed',
                photoCount: PHOTO_COUNT,
                fixture: {
                  width: 512,
                  height: 640,
                  format: 'synthetic JPEG',
                  bytes: 74721,
                },
                encryptedWithPhotoVaultCodec: true,
              },
              null,
              2
            )
          );
          if (active) {
            setDone(true);
            setStatus('Synthetic seed complete');
          }
          return;
        }
        const visits: Visit[] = [];
        stage = 'gallery_measurement';
        for (const visitName of [
          'cold-process-first-open',
          'warm-same-process-reopen',
        ]) {
          if (!active) return;
          setStatus(`${variant}: ${visitName}`);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          visits.push(await measureVisit(variant, probe, setMounted));
        }
        const output = {
          schema: 1,
          buildSentinel: BUILD_SENTINEL,
          variant,
          photoCount: PHOTO_COUNT,
          fixture: {
            width: 512,
            height: 640,
            format: 'synthetic JPEG',
            bytes: 74721,
          },
          coldWarmDefinition:
            'Cold is the first gallery mount after a fresh app process with empty private view cache; warm is a second gallery mount in the same process after confirmed view-cache cleanup. OS page cache is cleared by reboot between baseline and candidate variants.',
          visits: visits.map((value, index) => ({
            name:
              index === 0
                ? 'cold-process-first-open'
                : 'warm-same-process-reopen',
            ...value,
          })),
        };
        await FileSystem.writeAsStringAsync(
          `${REPORT_PREFIX}${variant}.json`,
          JSON.stringify(output, null, 2)
        );
        if (active) {
          setDone(true);
          setStatus(`Complete: ${variant}`);
        }
      } catch (error) {
        const code =
          error instanceof HarnessFailure ? error.code : `${stage}_failed`;
        await FileSystem.writeAsStringAsync(
          `${REPORT_PREFIX}${variant}.json`,
          JSON.stringify(
            {
              schema: 1,
              buildSentinel: BUILD_SENTINEL,
              variant,
              stage,
              errorCode: code,
            },
            null,
            2
          )
        );
        if (active) setStatus(`Failed: ${stage}/${code}`);
      }
    })();
    return () => {
      active = false;
    };
  }, [variant]);

  const Gallery =
    variant === 'candidate' ? GalleryPerfCandidate : GalleryPerfBaseline;
  return (
    <View style={{ flex: 1 }}>
      {mounted && Gallery ? (
        <Gallery onClose={() => setMounted(false)} onShareState={() => {}} />
      ) : null}
      <Text
        accessibilityLabel="gallery-perf-status"
        style={{ position: 'absolute', bottom: 2, left: 2, fontSize: 1 }}
      >
        {status}
      </Text>
      {done ? (
        <Text accessibilityLabel="gallery-perf-done">{BUILD_SENTINEL}</Text>
      ) : null}
    </View>
  );
}
