import { downloadWithPlaywright } from './playwright.js';
import logger from '../utils/logger.js';
import { getDownloadPath } from '../utils/fileManager.js';

/**
 * Orchestrates the download of a RedNote video using Playwright.
 * 
 * @param {string} url - The RedNote video URL
 * @param {string} noteId - The ID of the note
 * @param {string} title - Optional title for logging
 * @returns {Promise<string>} - Absolute path to downloaded video
 */
export async function downloadVideo(url, noteId, title = '') {
  const displayTitle = title ? ` (${title})` : '';
  const outputPath = getDownloadPath(noteId);
  
  try {
    logger.info(`Downloading with Playwright: ${url}${displayTitle}`);
    return await downloadWithPlaywright(url, outputPath);
  } catch (pwErr) {
    logger.error(`Playwright download failed: ${pwErr.message}`);
    throw new Error(`Failed to download video ${url}: ${pwErr.message}`);
  }
}
export default { downloadVideo };
