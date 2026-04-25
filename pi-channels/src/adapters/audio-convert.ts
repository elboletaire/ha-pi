/**
 * Audio conversion helper — converts Telegram voice files (.oga/ogg Opus)
 * to raw PCM suitable for speech-to-text engines.
 *
 * Uses ffmpeg via child_process.
 */

import { execFileSync } from 'node:child_process'

/**
 * Convert an audio file to raw PCM (16 kHz, mono, 16-bit signed LE).
 *
 * @param inputPath - Path to input audio file (e.g. .oga, .ogg, .mp3)
 * @returns PCM buffer, or null if conversion fails
 */
export function convertToPcm(inputPath: string): Buffer | null {
  try {
    const result = execFileSync(
      'ffmpeg',
      ['-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 's16le', '-loglevel', 'error', 'pipe:1'],
      {
        maxBuffer: 50 * 1024 * 1024, // 50 MB — PCM is ~32KB/s at 16kHz, so 10min audio ≈ 19MB
        timeout: 30_000, // 30s — enough for large audio files
      }
    )
    return Buffer.from(result)
  } catch {
    return null
  }
}
