import RNFS from 'react-native-fs';

import { EnmoSample } from '../ble/samples';
import { DATA_ROOT_DIR as ROOT_DIR } from './paths';

export interface SessionDeviceInfo {
  id: string;
  name: string;
}

export interface SessionInfo {
  subjectId: string;
  sessionId: string;
  participantEncoding: number;
  devices: SessionDeviceInfo[];
  startedAt: string;
}

/**
 * Appends one line per notification as "ENMO Counter PhoneUnixTime", single-space
 * separated, no header -- the three-column layout yams/msense_yams_sync.py's
 * load_yams_txt() expects from a desktop YAMS .txt file. Files produced here
 * can be dropped straight into that existing sync tooling.
 *
 * Column 3 is phone unix time at the moment the notification reached JS, by
 * design -- not a device time reconstructed from the counter. The hardware
 * counter is already column 2, so reconstructing would make column 3 a redundant
 * linear function of it and throw away the only wall-clock reference in the file.
 * Two consequences follow, and both are accepted: the spacing carries BLE and
 * JS-scheduler jitter rather than exact 1/fs steps, and the value is wall clock,
 * so an NTP correction mid-session can make it jump or step backwards. Use
 * column 2 to detect dropped notifications.
 */
export class SessionLogger {
  private filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(sessionDir: string, deviceLabel: string, deviceId: string) {
    const safeLabel = deviceLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.filePath = `${ROOT_DIR}/${sessionDir}/${safeLabel}_${safeId}.txt`;
  }

  static async newSessionDir(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = `${ROOT_DIR}/${stamp}`;
    await RNFS.mkdir(dir);
    return stamp;
  }

  /** Writes/overwrites session_info.json with subject/session id and the device set in use. */
  static async writeSessionInfo(sessionDir: string, info: SessionInfo): Promise<void> {
    const path = `${ROOT_DIR}/${sessionDir}/session_info.json`;
    await RNFS.writeFile(path, JSON.stringify(info, null, 2), 'utf8');
  }

  get path(): string {
    return this.filePath;
  }

  append(sample: EnmoSample): void {
    const line = `${sample.enmo} ${sample.counter} ${sample.unixTime}\n`;
    this.queue = this.queue.then(async () => {
      const exists = await RNFS.exists(this.filePath);
      if (!exists) {
        await RNFS.writeFile(this.filePath, line, 'utf8');
      } else {
        await RNFS.appendFile(this.filePath, line, 'utf8');
      }
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}
