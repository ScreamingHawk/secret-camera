type OperationSnapshot = { running: boolean; progress: string; result: string };
let active: Promise<void> | null = null;
let snapshot: OperationSnapshot = { running: false, progress: '', result: '' };
const listeners = new Set<(value: OperationSnapshot) => void>();

function publish(next: OperationSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribePhotoOperation(
  listener: (value: OperationSnapshot) => void
) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function getPhotoOperationSnapshot() {
  return snapshot;
}

export function runPhotoOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (active)
    return Promise.reject(new Error('A photo operation is already running'));
  publish({ running: true, progress: 'Preparing…', result: '' });
  const task = Promise.resolve().then(operation);
  active = task.then(
    () => undefined,
    () => undefined
  );
  return task.finally(() => {
    active = null;
    publish({ ...snapshot, running: false, progress: '' });
  });
}

export function setPhotoOperationProgress(progress: string) {
  if (active) publish({ ...snapshot, progress });
}

export function finishPhotoOperation(result: string) {
  if (active) publish({ ...snapshot, result });
}

export function isPhotoOperationRunning() {
  return active !== null;
}

export async function waitForPhotoOperation() {
  await active;
}
