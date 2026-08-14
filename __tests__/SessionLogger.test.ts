/**
 * @format
 */

jest.mock('react-native-fs', () => {
  const files = new Map<string, string>();
  const dirs: string[] = [];

  return {
    __files: files,
    __dirs: dirs,
    DocumentDirectoryPath: '/documents',
    DownloadDirectoryPath: '/downloads',
    exists: jest.fn(async (path: string) => files.has(path)),
    writeFile: jest.fn(async (path: string, contents: string) => {
      files.set(path, contents);
    }),
    appendFile: jest.fn(async (path: string, contents: string) => {
      files.set(path, (files.get(path) ?? '') + contents);
    }),
    mkdir: jest.fn(async (path: string) => {
      dirs.push(path);
    }),
  };
});

import { EnmoSample } from '../src/ble/samples';
// Derived rather than hardcoded: the root differs by platform, and this suite runs
// under jest's ios defaultPlatform.
import { DATA_ROOT_DIR } from '../src/storage/paths';
import { DEMO_SESSION_PREFIX, SessionLogger } from '../src/storage/SessionLogger';

const fs = jest.requireMock('react-native-fs') as {
  __files: Map<string, string>;
  __dirs: string[];
};

const sample = (enmo: number, counter: number, unixTime: number): EnmoSample => ({
  enmo,
  counter,
  unixTime,
});

beforeEach(() => {
  fs.__files.clear();
  fs.__dirs.length = 0;
});

describe('SessionLogger line format', () => {
  /**
   * This is the contract with the desktop msense_yams_sync.py pipeline. If these
   * assertions need updating, that consumer needs updating in the same change.
   */
  it('writes "ENMO Counter PhoneUnixTime", single-space separated, no header', async () => {
    const logger = new SessionLogger('2026-08-14', 'MSense4', 'AA-BB');

    logger.append(sample(0.0123, 1024, 1786568513.454));
    logger.append(sample(0, 2048, 1786568515.456));
    await logger.flush();

    expect(fs.__files.get(logger.path)).toBe(
      '0.0123 1024 1786568513.454\n0 2048 1786568515.456\n',
    );
  });

  it('keeps appends in order despite append() being fire-and-forget', async () => {
    const logger = new SessionLogger('2026-08-14', 'MSense4', 'AA-BB');

    for (let i = 1; i <= 20; i += 1) logger.append(sample(0, i * 1024, i));
    await logger.flush();

    const counters = (fs.__files.get(logger.path) ?? '')
      .trim()
      .split('\n')
      .map(line => Number(line.split(' ')[1]));

    expect(counters).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) * 1024));
  });

  it('sanitises the device label and id into the file name', () => {
    const logger = new SessionLogger('2026-08-14', 'MSense 4/ECG', 'AA:BB:CC');
    expect(logger.path).toBe(`${DATA_ROOT_DIR}/2026-08-14/MSense_4_ECG_AA_BB_CC.txt`);
  });
});

describe('demo sessions', () => {
  it('prefixes the session directory so synthetic data is obvious', async () => {
    const dir = await SessionLogger.newSessionDir(DEMO_SESSION_PREFIX);

    expect(dir.startsWith('DEMO-')).toBe(true);
    expect(fs.__dirs[0]).toBe(`${DATA_ROOT_DIR}/${dir}`);
  });

  it('leaves real session directories unprefixed', async () => {
    const dir = await SessionLogger.newSessionDir();
    expect(dir.startsWith('DEMO-')).toBe(false);
  });

  it('records the simulated flag in session_info.json', async () => {
    await SessionLogger.writeSessionInfo('DEMO-2026-08-14', {
      subjectId: 'sub-1000',
      sessionId: 'ses-00',
      participantEncoding: 100_000,
      devices: [{ id: 'simulated-msense-0001', name: 'MSense-SIM (simulated)' }],
      startedAt: '2026-08-14T00:00:00.000Z',
      simulated: true,
    });

    const written = fs.__files.get(`${DATA_ROOT_DIR}/DEMO-2026-08-14/session_info.json`);
    expect(JSON.parse(written ?? '{}').simulated).toBe(true);
  });
});
