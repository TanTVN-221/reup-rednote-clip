import { mkdir, access, readdir, unlink, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import config from '../../config/default.js';
import logger from './logger.js';

/**
 * Ensure all required data directories exist.
 */
export async function ensureDirectories() {
  const dirs = [
    config.dataDir,
    config.downloadsDir,
    config.transcriptsDir,
    config.translatedDir,
    config.outputDir,
    config.tempDir,
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  logger.debug('Data directories ensured');
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a safe filename from a title string.
 */
export function safeFilename(title, ext = '.mp4') {
  const safe = title
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')  // keep Chinese chars, alphanumeric, spaces, hyphens
    .replace(/\s+/g, '_')
    .substring(0, 80);
  return `${safe}${ext}`;
}

/**
 * Generate a unique filename by appending a number if the file already exists.
 */
export async function uniqueFilename(dir, name, ext = '.mp4') {
  const baseName = name.replace(new RegExp(`${ext}$`), '');
  let candidate = join(dir, `${baseName}${ext}`);
  let counter = 1;

  while (await fileExists(candidate)) {
    candidate = join(dir, `${baseName}_${counter}${ext}`);
    counter++;
  }
  return candidate;
}

/**
 * Get the download path for a video by its note ID.
 */
export function getDownloadPath(noteId, title = '') {
  const filename = title ? safeFilename(title) : `${noteId}.mp4`;
  return join(config.downloadsDir, filename);
}

/**
 * Get the transcript path for a video.
 */
export function getTranscriptPath(noteId) {
  return join(config.transcriptsDir, `${noteId}.srt`);
}

/**
 * Get the translated SRT path for a video.
 */
export function getTranslatedPath(noteId) {
  return join(config.translatedDir, `${noteId}_vi.srt`);
}

/**
 * Get the output path for a processed video.
 */
export function getOutputPath(noteId, title = '') {
  const filename = title ? safeFilename(title) : `${noteId}.mp4`;
  return join(config.outputDir, `vi_${filename}`);
}

/**
 * Get a temp file path.
 */
export function getTempPath(filename) {
  return join(config.tempDir, filename);
}

/**
 * Clean up temp files.
 */
export async function cleanTemp() {
  try {
    const files = await readdir(config.tempDir);
    for (const file of files) {
      await unlink(join(config.tempDir, file));
    }
    logger.debug('Temp directory cleaned');
  } catch (err) {
    logger.debug('No temp files to clean');
  }
}

/**
 * Clean up transcripts and translated cache files.
 */
export async function cleanCache() {
  const dirs = [config.transcriptsDir, config.translatedDir];
  for (const dir of dirs) {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        await unlink(join(dir, file));
      }
    } catch (err) {
      // ignore
    }
  }
  logger.debug('Cache directories cleaned');
}

/**
 * Get file size in MB.
 */
export async function getFileSizeMB(filePath) {
  try {
    const stats = await stat(filePath);
    return (stats.size / (1024 * 1024)).toFixed(2);
  } catch {
    return 0;
  }
}
