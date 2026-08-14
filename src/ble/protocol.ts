/**
 * MotionSenSE GATT protocol constants.
 *
 * Mirrors the desktop YAMS implementation (yams/msense_collector.py) so the
 * mobile app talks to the exact same firmware without any device-side changes.
 */

// Matched case-insensitively as a substring of the advertised device name
// (see BleController.startScan), so this is a token, not an exact name.
export const DEFAULT_DEVICE_NAME_FILTER = 'MSense';

// Control service: unix time / participant encoding / collection start-stop / erase
export const SERVICE_CONTROL = 'da39c930-1d81-48e2-9c68-d0ae4bbd351f';
export const CHAR_UNIX_TIME = 'da39c932-1d81-48e2-9c68-d0ae4bbd351f'; // write uint64 LE (seconds)
export const CHAR_PARTICIPANT_ENC = 'da39c933-1d81-48e2-9c68-d0ae4bbd351f'; // write/read uint32 LE
export const CHAR_COLLECTION_CTL = 'da39c931-1d81-48e2-9c68-d0ae4bbd351f'; // write/read uint32 LE (1=start, 0=stop)
export const CHAR_ERASE = 'da39c934-1d81-48e2-9c68-d0ae4bbd351f'; // write uint32 LE passcode (68)

// ENMO/counter notify service
export const SERVICE_ENMO = 'da39c950-1d81-48e2-9c68-d0ae4bbd351f';
export const CHAR_ENMO = 'da39c951-1d81-48e2-9c68-d0ae4bbd351f'; // notify: float32 ENMO + uint16|uint32 counter

// Standard BLE services
export const SERVICE_BATTERY = '0000180f-0000-1000-8000-00805f9b34fb';
export const CHAR_BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb'; // read/notify uint8 percent
export const SERVICE_DEVICE_INFO = '0000180a-0000-1000-8000-00805f9b34fb';
export const CHAR_MODEL_NUMBER = '00002a24-0000-1000-8000-00805f9b34fb'; // read utf-8 string

export const ERASE_PASSCODE = 68;

/**
 * Hardware counter sample rate. 512 Hz for firmware v4.7.0+, 320/25 Hz for legacy
 * devices (see yams/data_extraction.py's legacy_fs handling). Used to reconstruct
 * device-clock timestamps from the notify payload's counter: t = t0 + counter / fs.
 */
export const DEFAULT_SAMPLE_RATE_HZ = 512;
export const LEGACY_SAMPLE_RATE_HZ = 25;
