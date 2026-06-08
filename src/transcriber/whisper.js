import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import config from '../../config/default.js';
import logger from '../utils/logger.js';
import { getTempPath, fileExists } from '../utils/fileManager.js';

const execFileAsync = promisify(execFile);

/**
 * Transcribe a video's audio to SRT subtitles using local Whisper.
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} outputSrtPath - Where to save the SRT file
 * @returns {Promise<string>} Path to the generated SRT file
 */
export async function transcribeVideo(videoPath, outputSrtPath) {
  logger.info(`Transcribing: ${videoPath}`);

  // Step 1: Extract audio from video
  const audioPath = getTempPath(`audio_${Date.now()}.wav`);
  await extractAudio(videoPath, audioPath);

  // Step 2: Run Whisper on the audio
  try {
    const srtContent = await runWhisper(audioPath);

    if (!srtContent || srtContent.trim().length === 0) {
      logger.warn('Whisper produced no output — video may have no speech');
      // Write an empty SRT file
      await writeFile(outputSrtPath, '', 'utf-8');
      return outputSrtPath;
    }

    await writeFile(outputSrtPath, srtContent, 'utf-8');
    logger.success(`Transcript saved: ${outputSrtPath}`);
    return outputSrtPath;

  } finally {
    // Clean up temp audio
    try {
      const { unlink } = await import('fs/promises');
      await unlink(audioPath);
    } catch { /* ignore */ }
  }
}

/**
 * Extract audio from a video file using FFmpeg.
 */
async function extractAudio(videoPath, audioPath) {
  logger.debug(`Extracting audio to: ${audioPath}`);

  const args = [
    '-i', videoPath,
    '-vn',                    // No video
    '-acodec', 'pcm_s16le',  // WAV format
    '-ar', '16000',           // 16kHz (Whisper optimal)
    '-ac', '1',               // Mono
    '-y',                     // Overwrite
    audioPath,
  ];

  try {
    await execFileAsync('ffmpeg', args, { timeout: 120000 });
    logger.debug('Audio extracted successfully');
  } catch (err) {
    throw new Error(`FFmpeg audio extraction failed: ${err.message}`);
  }
}

/**
 * Run Whisper on an audio file using whisper-node or whisper.cpp CLI.
 * Returns SRT-formatted content.
 */
async function runWhisper(audioPath) {
  // Try using whisper-node (Node.js binding for whisper.cpp)
  try {
    const whisperModule = await import('whisper-node');
    const whisperFunc = whisperModule.whisper || (whisperModule.default && whisperModule.default.whisper);

    if (typeof whisperFunc !== 'function') {
      throw new Error(`Failed to extract whisper function from module. Exports: ${Object.keys(whisperModule)}`);
    }

    const options = {
      modelName: config.whisper.modelName,
      whisperOptions: {
        language: config.whisper.language,
        word_timestamps: false,
      },
    };

    const transcript = await whisperFunc(audioPath, options);

    if (!transcript || transcript.length === 0) {
      return '';
    }

    // Convert whisper-node output to SRT format
    return convertToSrt(transcript);

  } catch (err) {
    logger.warn(`whisper-node failed: ${err.message}, trying whisper CLI...`);

    // Fallback: try whisper CLI (Python-based)
    return await runWhisperCli(audioPath);
  }
}

/**
 * Fallback: Run OpenAI Whisper CLI (Python).
 */
async function runWhisperCli(audioPath) {
  const outputDir = getTempPath('');

  const args = [
    audioPath,
    '--model', config.whisper.modelName,
    '--language', config.whisper.language,
    '--output_format', 'srt',
    '--output_dir', outputDir,
  ];

  try {
    await execFileAsync('whisper', args, {
      timeout: 300000, // 5 min timeout
      maxBuffer: 10 * 1024 * 1024,
    });

    // Read the generated SRT file
    const srtFile = audioPath.replace(/\.\w+$/, '.srt');
    const srtInOutput = join(outputDir, srtFile.split('/').pop());

    for (const candidate of [srtInOutput, srtFile]) {
      if (await fileExists(candidate)) {
        return await readFile(candidate, 'utf-8');
      }
    }

    throw new Error('Whisper CLI produced no SRT output');
  } catch (err) {
    throw new Error(`Whisper CLI failed: ${err.message}`);
  }
}

/**
 * Convert whisper-node output to SRT format.
 */
function convertToSrt(segments) {
  let srt = '';
  let index = 1;

  for (const seg of segments) {
    const start = formatSrtTime(seg.start);
    const end = formatSrtTime(seg.end);
    const text = seg.speech?.trim() || seg.text?.trim() || '';

    if (text) {
      srt += `${index}\n`;
      srt += `${start} --> ${end}\n`;
      srt += `${text}\n\n`;
      index++;
    }
  }

  return srt;
}

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm).
 */
function formatSrtTime(seconds) {
  if (typeof seconds === 'string') {
    // Already formatted
    return seconds;
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 1000) % 1000);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export default { transcribeVideo };
