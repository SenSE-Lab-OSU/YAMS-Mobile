import base64 from 'base64-js';

/**
 * react-native-ble-plx reads/writes characteristic values as base64 strings.
 * These helpers pack/unpack the small little-endian payloads the MotionSenSE
 * firmware expects, matching struct.pack('<I'/'<Q'/'<f', ...) on the desktop side.
 */

export function uint32LEToBase64(value: number): string {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return base64.fromByteArray(buf);
}

export function uint64LEToBase64(value: number): string {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  // Split into low/high 32-bit words; unix seconds fits well within 2^53 (Number.isSafeInteger).
  const low = value >>> 0;
  const high = Math.floor(value / 0x100000000) >>> 0;
  view.setUint32(0, low, true);
  view.setUint32(4, high, true);
  return base64.fromByteArray(buf);
}

export function base64ToBytes(b64: string): Uint8Array {
  return base64.toByteArray(b64);
}

export function bytesToUint32LE(bytes: Uint8Array, offset = 0): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

export function bytesToUint16LE(bytes: Uint8Array, offset = 0): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

export function bytesToFloat32LE(bytes: Uint8Array, offset = 0): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
}

export function bytesToUint8(bytes: Uint8Array, offset = 0): number {
  return bytes[offset];
}
