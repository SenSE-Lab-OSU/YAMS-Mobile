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
 * Appends one line per notification as "ENMO Counter t_unixc_lin", whitespace
 * separated, no header -- the same layout yams/msense_yams_sync.py's
 * load_yams_txt() expects from a desktop YAMS .txt file. Files produced here
 * can be dropped straight into that existing sync tooling.
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
    const line = `${sample.enmo} ${sample.counter} ${sample.deviceTime}\n`;
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
