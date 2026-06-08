import { downloadWithYtdlp } from './ytdlp.js';
import { downloadWithPlaywright } from './playwright.js';
import { downloadWithApify } from './apify.js';
import logger from '../utils/logger.js';
import { getOutputPath } from '../utils/fileManager.js';
import config from '../../config/default.js';

/**
 * Orchestrates the download of a RedNote video.
 * Tries Apify first (if configured), then yt-dlp, falling back to Playwright.
 * 
 * @param {string} url - The RedNote video URL
 * @param {string} noteId - The ID of the note
 * @param {string} title - Optional title for logging
 * @returns {Promise<string>} - Absolute path to downloaded video
 */
export async function downloadVideo(url, noteId, title = '') {
  const displayTitle = title ? ` (${title})` : '';
  
  // Method 1: Apify (Most reliable if configured)
  if (config.apify.token) {
    try {
      logger.info(`Downloading with Apify: ${url}`);
      return await downloadWithApify(url, noteId);
    } catch (err) {
      logger.warn(`Apify failed, falling back to yt-dlp: ${err.message}`);
    }
  }

  // Method 2: yt-dlp (Fast CLI tool)
  try {
    logger.info(`Downloading with yt-dlp: ${url}${displayTitle}`);
    return await downloadWithYtdlp(url, noteId);
  } catch (err) {
    logger.warn(`yt-dlp failed, falling back to Playwright: ${err.message}`);
    
    // Method 3: Playwright fallback (Network interception)
    try {
      logger.info(`Downloading with Playwright: ${url}${displayTitle}`);
      return await downloadWithPlaywright(url, noteId);
    } catch (pwErr) {
      logger.error(`Playwright download also failed: ${pwErr.message}`);
      throw new Error(`All download methods failed for ${url}: ${pwErr.message}`);
    }
  }
}
export default { downloadVideo };
