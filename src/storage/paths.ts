import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

// Android's DocumentDirectoryPath is private internal storage with no file-manager
// access at all, and ExternalDirectoryPath (Android/data/<package>/files) is hidden
// from file manager UIs (Samsung My Files, Google Files, etc.) on Android 11+ even
// though it's technically on external storage. DownloadDirectoryPath is a real public
// directory, so files land in a normal, always-visible Downloads folder. iOS keeps
// DocumentDirectoryPath, exposed via the UIFileSharingEnabled/
// LSSupportsOpeningDocumentsInPlace Info.plist keys.
export const DATA_ROOT_DIR =
  Platform.OS === 'android'
    ? `${RNFS.DownloadDirectoryPath}/yams-mobile-data`
    : `${RNFS.DocumentDirectoryPath}/yams-mobile-data`;

// App-private storage for bookkeeping that is not research output. Deliberately
// separate from DATA_ROOT_DIR: on Android that's a public folder a researcher
// copies from and may clear, and anything left there also ends up in front of the
// desktop sync tooling. Internal state should be neither.
export const INTERNAL_DIR = RNFS.DocumentDirectoryPath;
