import { bytesToFloat32LE, bytesToUint16LE, bytesToUint32LE } from './binary';

export interface EnmoSample {
  enmo: number;
  counter: number;
  hostTimeMs: number; // Date.now() at arrival in the JS notify callback
  deviceTime: number; // seconds since epoch, t0 + counter / sampleRateHz
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
