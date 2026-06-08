// TikTok Content Posting API — Phase 2 (Optional)
// Requires TikTok Developer account and app registration.
// See: https://developers.tiktok.com/doc/content-posting-api-get-started/

import config from '../../config/default.js';
import logger from '../utils/logger.js';

/**
 * Upload a video to TikTok using the Content Posting API.
 *
 * NOTE: This is a skeleton implementation for Phase 2.
 * Full implementation requires:
 *   1. Register app at https://developers.tiktok.com/
 *   2. Enable "Content Posting API" product
 *   3. Implement OAuth 2.0 flow to get user access_token
 *   4. Submit app for review (for production use)
 *
 * @param {string} videoPath - Path to the video file
 * @param {object} options - Upload options
 * @param {string} options.title - Video title/description
 * @param {string[]} options.tags - Hashtags
 * @param {boolean} options.asDraft - Upload as draft (to inbox)
 */
export async function uploadToTiktok(videoPath, options = {}) {
  const { title = '', tags = [], asDraft = true } = options;

  if (!config.tiktok.clientKey || !config.tiktok.clientSecret) {
    throw new Error(
      'TikTok API credentials not configured.\n' +
      'Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in your .env file.\n' +
      'See: https://developers.tiktok.com/doc/content-posting-api-get-started/'
    );
  }

  logger.warn('TikTok upload is Phase 2 — not yet implemented');
  logger.info('To implement, follow the TikTok Content Posting API guide:');
  logger.info('1. Register app at https://developers.tiktok.com/');
  logger.info('2. Enable "Content Posting API" product');
  logger.info('3. Implement OAuth 2.0 flow');
  logger.info('4. Use POST /v2/post/publish/video/init/ to start upload');
  logger.info('5. PUT video data to the upload URL');

  // TODO: Implement the actual upload flow
  // Step 1: Query creator info
  // Step 2: Initialize upload
  // Step 3: Upload video file
  // Step 4: Check publish status

  return {
    success: false,
    message: 'TikTok upload not yet implemented (Phase 2)',
  };
}

export default { uploadToTiktok };
