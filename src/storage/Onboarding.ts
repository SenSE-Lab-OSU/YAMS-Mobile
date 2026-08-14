import RNFS from 'react-native-fs';

import { INTERNAL_DIR } from './paths';

/**
 * Records that the first-launch tour has been seen.
 *
 * Kept in app-private storage rather than DATA_ROOT_DIR: on Android that is a
 * public Downloads folder a researcher copies from and periodically clears, and
 * clearing session data should not make the app act like a fresh install.
 *
 * Unlike the simulated-device switch, this one is persisted on purpose -- the
 * tour is an introduction, not a setting.
 */
const FLAG_PATH = `${INTERNAL_DIR}/.onboarding-complete`;

export const Onboarding = {
  async hasCompleted(): Promise<boolean> {
    try {
      return await RNFS.exists(FLAG_PATH);
    } catch (error) {
      // Treat an unreadable flag as "already seen". Showing the tour again is a
      // smaller harm than trapping someone in it every launch.
      console.warn('Could not read onboarding flag', error);
      return true;
    }
  },

  async markCompleted(): Promise<void> {
    try {
      await RNFS.writeFile(FLAG_PATH, new Date().toISOString(), 'utf8');
    } catch (error) {
      console.warn('Could not record onboarding completion', error);
    }
  },
};
