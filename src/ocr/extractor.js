import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import Tesseract from 'tesseract.js';
import config from '../../config/default.js';
import logger from '../utils/logger.js';
import { getTempPath } from '../utils/fileManager.js';

const execFileAsync = promisify(execFile);

/**
 * Extract on-screen Chinese text from video frames using OCR.
 *
 * @param {string} videoPath - Path to the video file
 * @returns {Promise<Array<{start: number, end: number, text: string}>>} Extracted text segments
 */
export async function extractTextFromVideo(videoPath) {
  logger.info(`Extracting on-screen text via OCR: ${videoPath}`);

  // Step 1: Extract frames at regular intervals
  const framesDir = getTempPath(`frames_${Date.now()}`);
  await extractFrames(videoPath, framesDir);

  // Step 2: Run OCR on each frame
  const frameFiles = await readdir(framesDir);
  const sortedFrames = frameFiles
    .filter(f => f.endsWith('.png'))
    .sort();

  if (sortedFrames.length === 0) {
    logger.warn('No frames extracted from video');
    return [];
  }

  logger.info(`Processing ${sortedFrames.length} frames for OCR...`);

  // Initialize Tesseract worker
  const worker = await Tesseract.createWorker(config.ocr.language);

  const segments = [];
  let previousText = '';

  try {
    for (let i = 0; i < sortedFrames.length; i++) {
      const framePath = join(framesDir, sortedFrames[i]);

      try {
        const { data } = await worker.recognize(framePath);

        if (data.confidence >= config.ocr.minConfidence && data.text.trim()) {
          const currentText = cleanOcrText(data.text);

          // Only add if text is different from previous frame (deduplication)
          if (currentText && currentText !== previousText) {
            const frameSeconds = i * config.ocr.frameInterval;
            segments.push({
              start: frameSeconds,
              end: frameSeconds + config.ocr.frameInterval,
              text: currentText,
              confidence: data.confidence,
            });
            previousText = currentText;
          }
        }
      } catch (err) {
        logger.debug(`OCR failed for frame ${sortedFrames[i]}: ${err.message}`);
      }
    }
  } finally {
    await worker.terminate();
  }

  // Clean up frames
  try {
    for (const frame of sortedFrames) {
      await unlink(join(framesDir, frame));
    }
    const { rmdir } = await import('fs/promises');
    await rmdir(framesDir);
  } catch { /* ignore */ }

  logger.success(`Extracted ${segments.length} text segments via OCR`);
  return segments;
}

/**
 * Extract frames from a video at regular intervals using FFmpeg.
 */
async function extractFrames(videoPath, outputDir) {
  const { mkdir } = await import('fs/promises');
  await mkdir(outputDir, { recursive: true });

  const fps = 1 / config.ocr.frameInterval; // e.g., 0.5 fps = 1 frame every 2 seconds

  const args = [
    '-i', videoPath,
    '-vf', `fps=${fps}`,
    '-q:v', '2',             // High quality JPEG
    '-y',
    join(outputDir, 'frame_%04d.png'),
  ];

  try {
    await execFileAsync('ffmpeg', args, { timeout: 120000 });
    logger.debug(`Frames extracted to ${outputDir}`);
  } catch (err) {
    throw new Error(`FFmpeg frame extraction failed: ${err.message}`);
  }
}

/**
 * Clean OCR text by removing noise and normalizing whitespace.
 */
function cleanOcrText(text) {
  return text
    .replace(/[\r\n]+/g, ' ')       // Collapse newlines
    .replace(/\s+/g, ' ')           // Normalize spaces
    .replace(/[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\w\s.,!?:;-]/g, '') // Keep CJK + basic punct
    .trim();
}

/**
 * Merge OCR segments with Whisper transcript segments.
 * Whisper segments take priority; OCR fills in visual-only text.
 */
export function mergeWithTranscript(ocrSegments, whisperSrt) {
  if (!whisperSrt || whisperSrt.trim().length === 0) {
    // No whisper output — convert OCR segments to SRT
    return ocrSegmentsToSrt(ocrSegments);
  }

  if (ocrSegments.length === 0) {
    return whisperSrt;
  }

  // Parse existing SRT to find covered time ranges
  const srtBlocks = parseSrt(whisperSrt);
  const coveredRanges = srtBlocks.map(b => ({ start: b.startSeconds, end: b.endSeconds }));

  // Add OCR segments that don't overlap with Whisper transcript
  const additionalBlocks = [];
  for (const ocr of ocrSegments) {
    const overlaps = coveredRanges.some(
      r => ocr.start < r.end && ocr.end > r.start
    );
    if (!overlaps) {
      additionalBlocks.push(ocr);
    }
  }

  if (additionalBlocks.length === 0) {
    return whisperSrt;
  }

  // Append OCR blocks to SRT
  let nextIndex = srtBlocks.length + 1;
  let appendSrt = '';

  for (const block of additionalBlocks) {
    appendSrt += `${nextIndex}\n`;
    appendSrt += `${formatSrtTime(block.start)} --> ${formatSrtTime(block.end)}\n`;
    appendSrt += `${block.text}\n\n`;
    nextIndex++;
  }

  return whisperSrt.trim() + '\n\n' + appendSrt;
}

/**
 * Convert OCR segments to SRT format.
 */
function ocrSegmentsToSrt(segments) {
  let srt = '';
  segments.forEach((seg, i) => {
    srt += `${i + 1}\n`;
    srt += `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n`;
    srt += `${seg.text}\n\n`;
  });
  return srt;
}

/**
 * Parse SRT content into blocks.
 */
function parseSrt(srtContent) {
  const blocks = [];
  const parts = srtContent.trim().split(/\n\n+/);

  for (const part of parts) {
    const lines = part.trim().split('\n');
    if (lines.length >= 3) {
      const timeLine = lines[1];
      const match = timeLine.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
      );
      if (match) {
        const startSeconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 1000;
        const endSeconds = parseInt(match[5]) * 3600 + parseInt(match[6]) * 60 + parseInt(match[7]) + parseInt(match[8]) / 1000;
        blocks.push({
          index: parseInt(lines[0]),
          startSeconds,
          endSeconds,
          text: lines.slice(2).join('\n'),
        });
      }
    }
  }

  return blocks;
}

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 1000) % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export default { extractTextFromVideo, mergeWithTranscript };
