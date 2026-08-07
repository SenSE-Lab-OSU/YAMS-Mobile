import RNFS from 'react-native-fs';

import { INTERNAL_DIR } from './paths';

export interface ActiveSessionDevice {
  id: string;
  name: string;
  /** t0 written to the device at collection start; null until startCollection runs. */
  clockOriginUnixSec: number | null;
}

export interface ActiveSession {
  /** Timestamp folder name under DATA_ROOT_DIR, as returned by SessionLogger.newSessionDir(). */
  sessionDir: string;
  subjectId: string;
  sessionId: string;
  participantEncoding: number;
  devices: ActiveSessionDevice[];
  startedAt: string;
}

const ACTIVE_SESSION_PATH = `${INTERNAL_DIR}/.active-session.json`;

// Every read and write goes through one promise chain. setClockOrigin() is
// read-modify-write, so two devices starting concurrently would otherwise be able
// to interleave and lose one of the two origins.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Records the in-flight collection session so a restarted process can pick it up
 * again -- on iOS, Core Bluetooth state restoration relaunches the app into a
 * fresh JS context where BleController's in-memory device map is empty, and the
 * clock origins established at collection start would otherwise be gone.
 *
 * Deliberately kept out of session_info.json: that file is read by the desktop
 * yams tooling, and this is internal bookkeeping with a different lifetime.
 */
export class SessionState {
  /** Replaces the active-session record. Call once when collection starts. */
  static save(session: ActiveSession): Promise<void> {
    return enqueue(() => SessionState.write(session));
  }

  /** Returns the active session, or null if none is in flight or the record is unusable. */
  static load(): Promise<ActiveSession | null> {
    return enqueue(() => SessionState.read());
  }

  /** Removes the record. Call when collection stops. */
  static clear(): Promise<void> {
    return enqueue(async () => {
      if (await RNFS.exists(ACTIVE_SESSION_PATH)) {
        await RNFS.unlink(ACTIVE_SESSION_PATH);
      }
    });
  }

  /**
   * Stores the clock origin for one device. No-ops when there is no active
   * session or the device is not part of it.
   */
  static setClockOrigin(deviceId: string, clockOriginUnixSec: number): Promise<void> {
    return enqueue(async () => {
      const session = await SessionState.read();
      if (!session) return;

      const device = session.devices.find(entry => entry.id === deviceId);
      if (!device) return;

      device.clockOriginUnixSec = clockOriginUnixSec;
      await SessionState.write(session);
    });
  }

  private static async read(): Promise<ActiveSession | null> {
    if (!(await RNFS.exists(ACTIVE_SESSION_PATH))) return null;
    try {
      return JSON.parse(await RNFS.readFile(ACTIVE_SESSION_PATH, 'utf8')) as ActiveSession;
    } catch (error) {
      // A truncated write (process killed mid-save) shouldn't wedge the next
      // session. Treat an unparseable record as no record.
      console.warn('Discarding unreadable active-session record', error);
      return null;
    }
  }

  private static async write(session: ActiveSession): Promise<void> {
    await RNFS.writeFile(ACTIVE_SESSION_PATH, JSON.stringify(session, null, 2), 'utf8');
  }
}
