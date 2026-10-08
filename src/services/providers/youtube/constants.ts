/**
 * Shared innertube client identity.
 *
 * Both the search provider and the built-in stream extractor talk to
 * youtubei with the same "ANDROID" client context. Keeping the constants in
 * one place means the two paths can't drift apart (a changed client version
 * that search relies on would silently break playback extraction too).
 */

/** Public youtubei API key used by innertube clients. */
export const YT_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/** Innertube client name that yields direct googlevideo URLs. */
export const YT_CLIENT_NAME = 'ANDROID';
export const YT_ANDROID_CLIENT_VERSION = '20.10.38';
export const YT_ANDROID_USER_AGENT =
  'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
export const YT_ANDROID_SDK_VERSION = 30;