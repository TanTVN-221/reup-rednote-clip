import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import config from '../config/default.js';
import logger from './utils/logger.js';
import { ensureDirectories, fileExists, getDownloadPath, getTranscriptPath, getTranslatedPath, getOutputPath, getTempPath, cleanTemp, getFileSizeMB } from './utils/fileManager.js';
import { pipelineHeader, withSpinner } from './utils/progress.js';
import { downloadVideo } from './downloader/index.js';
import { transcribeVideo } from './transcriber/whisper.js';
import { extractTextFromVideo, mergeWithTranscript } from './ocr/extractor.js';
import { translateSrt } from './translator/index.js';
import { burnSubtitles, shiftSrtTimestamps } from './video/subtitle.js';
import { addTtsVoiceover } from './video/tts.js';

const TOTAL_STEPS = 7;

/**
 * Process a single video through the full pipeline.
 *
 * @param {object} video - Video info {noteId, title, url}
 * @param {object} options - Pipeline options
 * @returns {Promise<{success: boolean, title: string, outputPath?: string, error?: string}>}
 */
export async function processVideo(video, options = {}) {
  const { noteId, title, url } = video;
  const skipDownload = options.skipDownload || false;
  const skipOcr = options.skipOcr || false;
  const skipTts = options.skipTts || false;

  logger.divider(`Processing: ${title || noteId}`);

  try {
    // Ensure directories exist
    await ensureDirectories();

    let currentStep = 0;

    // ── Step 1: Download video ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    let videoPath;
    if (skipDownload && options.videoPath) {
      videoPath = options.videoPath;
      logger.info(`Using provided video: ${videoPath}`);
    } else {
      videoPath = await withSpinner('Downloading video', async () => {
        return await downloadVideo(url, noteId, title);
      });
    }

    const sizeMB = await getFileSizeMB(videoPath);
    logger.info(`Video size: ${sizeMB} MB`);

    // ── Step 2: Speech-to-Text (Whisper) ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    const transcriptPath = getTranscriptPath(noteId);
    let whisperSrt = '';

    if (await fileExists(transcriptPath)) {
      logger.info('Using cached transcript');
      whisperSrt = await readFile(transcriptPath, 'utf-8');
    } else {
      await withSpinner('Transcribing audio (Whisper)', async () => {
        await transcribeVideo(videoPath, transcriptPath);
      });
      whisperSrt = await readFile(transcriptPath, 'utf-8');
    }

    // ── Step 3: OCR Text Extraction ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    let mergedSrt = whisperSrt;

    if (!skipOcr) {
      const ocrSegments = await withSpinner('Extracting on-screen text (OCR)', async () => {
        return await extractTextFromVideo(videoPath);
      });

      if (ocrSegments.length > 0) {
        mergedSrt = mergeWithTranscript(ocrSegments, whisperSrt);
        // Save merged transcript
        await writeFile(transcriptPath, mergedSrt, 'utf-8');
        logger.info(`Merged ${ocrSegments.length} OCR segments with transcript`);
      }
    } else {
      logger.info('OCR skipped');
    }

    // ── Step 4: Translate to Vietnamese ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    const translatedPath = getTranslatedPath(noteId);

    if (await fileExists(translatedPath)) {
      logger.info('Using cached translation');
    } else {
      // Save the merged SRT first (in case translation uses it)
      await writeFile(transcriptPath, mergedSrt, 'utf-8');

      await withSpinner('Translating to Vietnamese', async () => {
        await translateSrt(transcriptPath, translatedPath);
      });
    }

    // ── Step 5: Burn subtitles ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    const subtitledVideoPath = getTempPath(`subtitled_${noteId}_${Date.now()}.mp4`);
    let srtPathToUse = translatedPath;
    
    // Shift subtitles if we are cutting the intro
    const cutIntro = config.video?.cutIntroSeconds || 0;
    if (cutIntro > 0) {
      logger.info(`Shifting subtitles backward by ${cutIntro}s to match trimmed video...`);
      const originalSrt = await readFile(translatedPath, 'utf-8');
      const shiftedSrt = shiftSrtTimestamps(originalSrt, cutIntro);
      srtPathToUse = getTempPath(`shifted_${noteId}_${Date.now()}.srt`);
      await writeFile(srtPathToUse, shiftedSrt, 'utf-8');
    }

    await withSpinner('Burning Vietnamese subtitles', async () => {
      await burnSubtitles(videoPath, srtPathToUse, subtitledVideoPath);
    });

    // ── Step 6: Add TTS voiceover ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    const outputPath = getOutputPath(noteId, title);
    let finalVideoPath;

    if (!skipTts) {
      await withSpinner('Adding Vietnamese TTS voiceover', async () => {
        finalVideoPath = await addTtsVoiceover(subtitledVideoPath, srtPathToUse, outputPath);
      });
    } else {
      logger.info('TTS skipped, copying subtitled video');
      const { copyFile } = await import('fs/promises');
      await copyFile(subtitledVideoPath, outputPath);
      finalVideoPath = outputPath;
    }

    // Clean up temp subtitled video and shifted SRT
    try {
      const { unlink } = await import('fs/promises');
      await unlink(subtitledVideoPath);
      if (srtPathToUse !== translatedPath) await unlink(srtPathToUse);
    } catch { /* ignore */ }

    // ── Step 7: Done! ──
    currentStep++;
    pipelineHeader(title || noteId, currentStep, TOTAL_STEPS);

    const outputSizeMB = await getFileSizeMB(finalVideoPath);
    logger.success(`Output: ${finalVideoPath} (${outputSizeMB} MB)`);

    return {
      success: true,
      title: title || noteId,
      outputPath: finalVideoPath,
    };

  } catch (err) {
    logger.error(`Pipeline failed for ${title || noteId}: ${err.message}`);
    return {
      success: false,
      title: title || noteId,
      error: err.message,
    };
  }
}

/**
 * Process all videos from a channel.
 *
 * @param {Array<{noteId: string, title: string, url: string}>} videos
 * @param {object} options
 * @returns {Promise<Array>} Results for each video
 */
export async function processChannel(videos, options = {}) {
  logger.info(`Processing ${videos.length} video(s)...`);

  const results = [];

  for (let i = 0; i < videos.length; i++) {
    logger.divider(`Video ${i + 1} of ${videos.length}`);
    const result = await processVideo(videos[i], options);
    results.push(result);

    // Small delay between videos
    if (i < videos.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

/**
 * Save pipeline state for resume capability.
 */
export async function savePipelineState(channelUrl, processedIds) {
  const statePath = join(config.dataDir, 'pipeline_state.json');
  let state = {};

  try {
    const existing = await readFile(statePath, 'utf-8');
    state = JSON.parse(existing);
  } catch { /* no existing state */ }

  state[channelUrl] = {
    processedIds,
    lastUpdated: new Date().toISOString(),
  };

  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Load pipeline state for resume capability.
 */
export async function loadPipelineState(channelUrl) {
  const statePath = join(config.dataDir, 'pipeline_state.json');

  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content);
    return state[channelUrl]?.processedIds || [];
  } catch {
    return [];
  }
}

export default { processVideo, processChannel };
