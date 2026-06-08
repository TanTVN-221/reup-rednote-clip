import { execFile } from 'child_process';
import { promisify } from 'util';
import config from '../../config/default.js';
import logger from '../utils/logger.js';
import { fileExists } from '../utils/fileManager.js';

const execFileAsync = promisify(execFile);

/**
 * Download a video using yt-dlp.
 *
 * @param {string} url - The RedNote video URL
 * @param {string} outputPath - Where to save the video
 * @returns {Promise<string>} The path to the downloaded video
 */
export async function downloadWithYtdlp(url, outputPath) {
  logger.info(`Downloading with yt-dlp: ${url}`);

  const args = [
    url,
    '-o', outputPath,
    '--no-warnings',
    '--no-playlist',
    '-f', 'best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--socket-timeout', '30',
    '--retries', String(config.downloader.maxRetries),
  ];

  // Add cookie if available
  if (config.rednote.cookie) {
    args.push('--add-header', `Cookie: ${config.rednote.cookie}`);
  }


  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
      timeout: config.downloader.timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) logger.debug(`yt-dlp stdout: ${stdout.trim()}`);

    // Verify the file was downloaded
    if (await fileExists(outputPath)) {
      logger.success(`Downloaded: ${outputPath}`);
      return outputPath;
    }

    // yt-dlp might have added a different extension — check common variants
    const variants = [
      outputPath.replace('.mp4', '.webm'),
      outputPath.replace('.mp4', '.mkv'),
    ];
    for (const variant of variants) {
      if (await fileExists(variant)) {
        logger.success(`Downloaded (alt format): ${variant}`);
        return variant;
      }
    }

    throw new Error('yt-dlp finished but output file not found');

  } catch (err) {
    if (err.killed) {
      throw new Error('yt-dlp download timed out');
    }
    throw new Error(`yt-dlp failed: ${err.message}`);
  }
}

/**
 * Check if yt-dlp is installed.
 */
export async function isYtdlpAvailable() {
  try {
    await execFileAsync('yt-dlp', ['--version']);
    return true;
  } catch {
    return false;
  }
}
