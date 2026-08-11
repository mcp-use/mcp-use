interface InitializableBridge<TArgs extends unknown[]> {
  oninitialized: ((...args: TArgs) => void) | undefined;
}

/**
 * Synchronize host state after every guest initialize handshake.
 *
 * Vite HMR and React development runtimes can replace the guest App instance
 * inside the same iframe. Each replacement initializes again and needs the
 * invocation's one-shot input/result notifications replayed.
 */
export function installInitializedSync<TArgs extends unknown[]>(
  bridge: InitializableBridge<TArgs>,
  synchronize: () => void | Promise<void>,
  onLaterError: (error: unknown) => void
): Promise<void> {
  const previous = bridge.oninitialized;
  let sawFirstInitialization = false;

  return new Promise<void>((resolve, reject) => {
    bridge.oninitialized = (...args: TArgs) => {
      previous?.(...args);
      const synchronization = Promise.resolve().then(synchronize);

      if (!sawFirstInitialization) {
        sawFirstInitialization = true;
        synchronization.then(resolve, reject);
        return;
      }

      void synchronization.catch(onLaterError);
    };
  });
}
