import { ApifyClient } from 'apify-client';
import { createWriteStream } from 'fs';
import { get } from 'https';
import { pipeline } from 'stream/promises';
import { getTempPath } from '../utils/fileManager.js';
import config from '../../config/default.js';
import logger from '../utils/logger.js';

/**
 * Downloads a RedNote video using an Apify Actor.
 * 
 * @param {string} url - The RedNote video URL
 * @param {string} noteId - The ID of the note/video
 * @returns {Promise<string>} - The absolute path to the downloaded video
 */
export async function downloadWithApify(url, noteId) {
  if (!config.apify.token) {
    throw new Error('APIFY_TOKEN is not configured.');
  }

  const client = new ApifyClient({
    token: config.apify.token,
  });

  const actorId = config.apify.actorId || 'apple_yang/rednote-video-audio-downloader';
  
  logger.info(`Starting Apify Actor (${actorId}) for URL: ${url}`);
  
  // The input schema varies slightly by actor, but most accept 'links' or 'urls'
  // and some require a mode. apple_yang/rednote-video-audio-downloader uses:
  const input = {
    links: [url],
    downloadMedia: false, // We will download the raw URL manually to save Apify compute time
  };

  try {
    // Run the Actor and wait for it to finish
    const run = await client.actor(actorId).call(input);
    
    logger.debug(`Apify run completed with ID: ${run.id}. Fetching results...`);

    // Fetch results from the run's default dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    
    if (items.length === 0) {
      throw new Error('Apify actor returned empty results. It may have failed to extract the video.');
    }

    const item = items[0];
    
    // Attempt to extract the video URL (different actors use different keys)
    const rawVideoUrl = item.videoUrl || item.video_url || item.url || (item.media && item.media.video);
    
    if (!rawVideoUrl) {
      logger.error('Apify returned data, but no video URL field could be found:', item);
      throw new Error('Failed to find video URL in Apify output.');
    }

    logger.info(`Extracted raw video URL from Apify: ${rawVideoUrl}`);
    
    // Download the video to local file
    const outputPath = getTempPath(`${noteId}_apify.mp4`);
    await downloadFileStream(rawVideoUrl, outputPath);
    
    return outputPath;
  } catch (error) {
    throw new Error(`Apify downloader failed: ${error.message}`);
  }
}

/**
 * Downloads a file from a URL stream to local disk
 */
function downloadFileStream(url, dest) {
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(dest);
    
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect
        logger.debug(`Following redirect to ${response.headers.location}`);
        return resolve(downloadFileStream(response.headers.location, dest));
      }
      
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download file, status code: ${response.statusCode}`));
      }
      
      pipeline(response, fileStream)
        .then(() => resolve(dest))
        .catch(reject);
    }).on('error', reject);
  });
}
