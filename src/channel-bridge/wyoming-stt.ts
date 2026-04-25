/**
 * Wyoming STT client — sends PCM audio to a Wyoming-compatible
 * speech-to-text server (e.g. Vosk) and returns the transcript.
 *
 * Protocol (v1.5): each event is written as:
 *   HEADER_JSON\n[DATA_JSON][PAYLOAD_BYTES]
 *
 * Where HEADER_JSON contains: type, version, data_length, payload_length (optional).
 * DATA_JSON is `data_length` bytes of JSON (no trailing newline).
 * PAYLOAD_BYTES is `payload_length` bytes of binary data (e.g. PCM audio).
 *
 * Flow:
 *   Client → Transcribe event
 *   Client → AudioChunk events (PCM data in payload)
 *   Client → AudioStop event
 *   Server → Transcript event (result in data.text)
 */

import * as net from 'node:net'

export interface WyomingSttOptions {
  host: string
  port: number
  language?: string
  timeoutMs?: number
}

const DEFAULTS: Required<WyomingSttOptions> = {
  host: 'localhost',
  port: 10300,
  language: 'en',
  timeoutMs: 60_000, // 60s — enough for large voice messages (several minutes of audio)
}

/** Audio chunk size in bytes (4 KB). */
const CHUNK_SIZE = 4096

/** Wyoming protocol version. */
const VERSION = '1.5.2'

/**
 * Send a Wyoming event over a TCP socket.
 *
 * Wire format:
 *   {"type":"...","version":"1.5.2","data_length":N[,"payload_length":M]}\n
 *   [N bytes of data JSON][M bytes of binary payload]
 */
function sendEvent(socket: net.Socket, type: string, data: Record<string, unknown> = {}, payload?: Buffer): void {
  const dataBytes = Buffer.from(JSON.stringify(data), 'utf-8')

  const header: Record<string, unknown> = {
    type,
    version: VERSION,
    data_length: dataBytes.length,
  }
  if (payload && payload.length > 0) {
    header.payload_length = payload.length
  }

  socket.write(JSON.stringify(header) + '\n')
  socket.write(dataBytes)
  if (payload && payload.length > 0) {
    socket.write(payload)
  }
}

/**
 * Transcribe PCM audio via the Wyoming protocol.
 *
 * @param pcmAudio - Raw PCM buffer (signed 16-bit LE, 16 kHz, mono)
 * @param options  - Host, port, language, timeout
 * @returns Transcribed text, or null on failure / empty result
 */
export function transcribeAudio(pcmAudio: Buffer, options?: Partial<WyomingSttOptions>): Promise<string | null> {
  const opts = { ...DEFAULTS, ...options }

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    // Accumulate raw bytes for proper binary-safe parsing
    let rawBuffer = Buffer.alloc(0)

    // Parser state: we alternate between reading a header line and
    // reading the data+payload bytes that follow it.
    let pendingDataLength = 0
    let pendingPayloadLength = 0
    let pendingHeaderType = ''

    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    // Hard timeout to avoid hanging forever
    const timer = setTimeout(() => finish(null), opts.timeoutMs)

    socket.on('error', () => finish(null))
    socket.on('close', () => {
      clearTimeout(timer)
      if (!settled) finish(null)
    })

    // Incoming data — parse Wyoming events
    socket.on('data', (chunk: Buffer) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk])
      parseEvents()
    })

    function parseEvents(): void {
      while (rawBuffer.length > 0) {
        // If we're waiting for data+payload bytes after a header
        if (pendingDataLength > 0 || pendingPayloadLength > 0) {
          const needed = pendingDataLength + pendingPayloadLength
          if (rawBuffer.length < needed) return // wait for more

          const dataJson = rawBuffer.subarray(0, pendingDataLength).toString('utf-8')
          rawBuffer = rawBuffer.subarray(needed)

          // Parse the data JSON for transcript events
          if (pendingHeaderType === 'transcript') {
            try {
              const data = JSON.parse(dataJson)
              const text = (data.text ?? '').trim()
              clearTimeout(timer)
              finish(text || null)
              return
            } catch {
              // Malformed data — ignore
            }
          }

          pendingDataLength = 0
          pendingPayloadLength = 0
          pendingHeaderType = ''
          continue
        }

        // Look for header line (terminated by \n)
        const nlIdx = rawBuffer.indexOf(0x0a) // \n
        if (nlIdx === -1) return // wait for more

        const headerLine = rawBuffer.subarray(0, nlIdx).toString('utf-8')
        rawBuffer = rawBuffer.subarray(nlIdx + 1)

        try {
          const header = JSON.parse(headerLine)
          pendingDataLength = header.data_length ?? 0
          pendingPayloadLength = header.payload_length ?? 0
          pendingHeaderType = header.type ?? ''
        } catch {
          // Skip unparseable header
        }
      }
    }

    socket.connect(opts.port, opts.host, () => {
      // 1. Start transcription session
      sendEvent(socket, 'transcribe', { language: opts.language })

      // 2. Stream audio in chunks
      for (let i = 0; i < pcmAudio.length; i += CHUNK_SIZE) {
        const end = Math.min(i + CHUNK_SIZE, pcmAudio.length)
        sendEvent(
          socket,
          'audio-chunk',
          { rate: 16000, width: 2, channels: 1, timestamp: null },
          pcmAudio.subarray(i, end)
        )
      }

      // 3. Signal end of audio
      sendEvent(socket, 'audio-stop', { timestamp: null })
    })
  })
}
