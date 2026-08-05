/**
 * Mirrors participant_encoding_default() in yams/msense_collector.py:
 * sub-XXXX / ses-YY -> integer XXXX*100 + YY, written to CHAR_PARTICIPANT_ENC.
 */
export function encodeParticipant(sub: string, ses: string): number {
  const subMatch = sub.match(/\d+/);
  const sesMatch = ses.match(/\d+/);
  const subNumber = subMatch ? parseInt(subMatch[0], 10) : 0;
  const sesNumber = sesMatch ? parseInt(sesMatch[0], 10) : 0;
  return subNumber * 100 + sesNumber;
}
