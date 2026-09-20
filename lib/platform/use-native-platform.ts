'use client';

/*
 * lib/platform/use-native-platform.ts
 *
 * Hydration-safe platform detection for Client Components. Returns "web"
 * defaults on the first render (matching the server) and resolves the real
 * platform in an effect, so conditional rendering never causes a hydration
 * mismatch.
 */
import { useEffect, useState } from 'react';
import { getPlatform, isMobileRuntime, type Platform } from './native';

export interface NativePlatformState {
  platform: Platform;
  isNative: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  /** Native app OR the dedicated mobile web origin. */
  isMobileRuntime: boolean;
  /** False until the effect has run — use to gate first-paint decisions. */
  ready: boolean;
}

const INITIAL: NativePlatformState = {
  platform: 'web',
  isNative: false,
  isIOS: false,
  isAndroid: false,
  isMobileRuntime: false,
  ready: false,
};

export function useNativePlatform(): NativePlatformState {
  const [state, setState] = useState<NativePlatformState>(INITIAL);

  useEffect(() => {
    const platform = getPlatform();
    setState({
      platform,
      isNative: platform !== 'web',
      isIOS: platform === 'ios',
      isAndroid: platform === 'android',
      isMobileRuntime: isMobileRuntime(),
      ready: true,
    });
  }, []);

  return state;
}
