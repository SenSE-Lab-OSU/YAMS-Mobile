/**
 * @format
 */

jest.mock('react-native-fs', () => {
  const files = new Map<string, string>();
  return {
    __esModule: true,
    __files: files,
    default: {
      DocumentDirectoryPath: '/documents',
      DownloadDirectoryPath: '/downloads',
      exists: async (path: string) => files.has(path),
      readFile: async (path: string) => {
        const contents = files.get(path);
        if (contents == null) throw new Error(`ENOENT: ${path}`);
        return contents;
      },
      writeFile: async (path: string, contents: string) => {
        files.set(path, contents);
      },
      unlink: async (path: string) => {
        files.delete(path);
      },
    },
  };
});

import { ActiveSession, SessionState } from '../src/storage/SessionState';

const files = (jest.requireMock('react-native-fs') as { __files: Map<string, string> }).__files;
const RECORD_PATH = '/documents/.active-session.json';

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionDir: '2026-08-07T12-00-00-000Z',
    subjectId: 'sub-1000',
    sessionId: 'ses-00',
    participantEncoding: 100000,
    devices: [
      { id: 'aa', name: 'MSense4', clockOriginUnixSec: null },
      { id: 'bb', name: 'MSense4ECG', clockOriginUnixSec: null },
    ],
    startedAt: '2026-08-07T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  files.clear();
});

describe('SessionState', () => {
  it('returns null when no session is in flight', async () => {
    await expect(SessionState.load()).resolves.toBeNull();
  });

  it('round-trips a saved session', async () => {
    const session = makeSession();
    await SessionState.save(session);
    await expect(SessionState.load()).resolves.toEqual(session);
  });

  it('records a clock origin against the matching device only', async () => {
    await SessionState.save(makeSession());
    await SessionState.setClockOrigin('bb', 1_780_000_000);

    const loaded = await SessionState.load();
    expect(loaded?.devices).toEqual([
      { id: 'aa', name: 'MSense4', clockOriginUnixSec: null },
      { id: 'bb', name: 'MSense4ECG', clockOriginUnixSec: 1_780_000_000 },
    ]);
  });

  it('keeps both origins when two devices start concurrently', async () => {
    await SessionState.save(makeSession());

    // Not awaited individually -- this is the interleaving the write queue exists
    // to prevent, since setClockOrigin is read-modify-write.
    await Promise.all([
      SessionState.setClockOrigin('aa', 1_780_000_001),
      SessionState.setClockOrigin('bb', 1_780_000_002),
    ]);

    const loaded = await SessionState.load();
    expect(loaded?.devices.map(device => device.clockOriginUnixSec)).toEqual([
      1_780_000_001, 1_780_000_002,
    ]);
  });

  it('ignores a clock origin for a device outside the session', async () => {
    const session = makeSession();
    await SessionState.save(session);
    await SessionState.setClockOrigin('zz', 1_780_000_000);
    await expect(SessionState.load()).resolves.toEqual(session);
  });

  it('no-ops setting a clock origin with no active session', async () => {
    await expect(SessionState.setClockOrigin('aa', 1_780_000_000)).resolves.toBeUndefined();
    await expect(SessionState.load()).resolves.toBeNull();
  });

  it('clears the record', async () => {
    await SessionState.save(makeSession());
    await SessionState.clear();
    await expect(SessionState.load()).resolves.toBeNull();
  });

  it('clearing when nothing is saved is not an error', async () => {
    await expect(SessionState.clear()).resolves.toBeUndefined();
  });

  it('treats a truncated record as no record', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    files.set(RECORD_PATH, '{"sessionDir":"2026-08-07T12-00-00-000Z","devi');

    await expect(SessionState.load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
