import { bytesToFloat32LE, bytesToUint16LE, bytesToUint32LE } from './binary';

export interface EnmoSample {
  enmo: number;
  counter: number;
  // Phone unix time (seconds, fractional) read at arrival in the JS notify
  // callback. Deliberately NOT reconstructed from the device clock -- see the
  // note on the third column in SessionLogger.
  unixTime: number;
}

/**
 * Decodes the da39c951 notify payload. Matches enmo_handler() in
 * yams/msense_collector.py: float32 ENMO followed by either a uint32 (new
 * firmware, 8-byte payload) or uint16 (legacy firmware, 6-byte payload) counter.
 */
export function decodeEnmoPayload(bytes: Uint8Array): { enmo: number; counter: number } {
  const enmo = bytesToFloat32LE(bytes, 0);
  const counter = bytes.length >= 8 ? bytesToUint32LE(bytes, 4) : bytesToUint16LE(bytes, 4);
  return { enmo, counter };
}

/**
 * Inverse of decodeEnmoPayload in the new-firmware 8-byte shape. Only the
 * simulator uses this -- real payloads come off the wire -- but it lives beside
 * the decoder so the two stay in step if the layout ever changes.
 */
export function encodeEnmoPayload(enmo: number, counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, enmo, true);
  view.setUint32(4, counter, true);
  return bytes;
}
