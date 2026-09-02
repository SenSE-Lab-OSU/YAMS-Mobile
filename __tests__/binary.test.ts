/**
 * @format
 */

import { bytesToBase64, bytesToUintLE, base64ToBytes, uint32LEToBase64 } from '../src/ble/binary';

describe('bytesToUintLE', () => {
  it('decodes a single byte', () => {
    expect(bytesToUintLE(Uint8Array.of(1))).toBe(1);
    expect(bytesToUintLE(Uint8Array.of(0))).toBe(0);
  });

  it('decodes multiple bytes little-endian', () => {
    // 0x0100 LE -> 256
    expect(bytesToUintLE(Uint8Array.of(0x00, 0x01))).toBe(256);
    // Matches a plain 4-byte uint32 LE decode for a value that fits either way.
    expect(bytesToUintLE(base64ToBytes(uint32LEToBase64(100500)))).toBe(100500);
  });

  it('does not throw on a shorter buffer than a fixed-width decode would need', () => {
    // This is the real-world case: CHAR_COLLECTION_CTL has been observed
    // reporting a 1-byte value on read, even though it's written as 4 bytes.
    // bytesToUint32LE would throw building a 4-byte DataView over this.
    expect(() => bytesToUintLE(Uint8Array.of(1))).not.toThrow();
  });

  it('round-trips through base64 the same way the BLE layer receives it', () => {
    const bytes = base64ToBytes(bytesToBase64(Uint8Array.of(1)));
    expect(bytesToUintLE(bytes)).toBe(1);
  });

  it('treats an empty buffer as 0', () => {
    expect(bytesToUintLE(new Uint8Array(0))).toBe(0);
  });
});
