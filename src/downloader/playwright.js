import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import config from '../../config/default.js';
import logger from '../utils/logger.js';

import path from 'path';

const BROWSER_DATA_DIR = path.resolve('data', '.browser-profile');

/**
 * Download a video using Playwright by intercepting network requests.
 *
 * @param {string} url - The RedNote video URL
 * @param {string} outputPath - Where to save the video
 * @returns {Promise<string>} The path to the downloaded video
 */
export async function downloadWithPlaywright(url, outputPath) {
  logger.info(`Downloading with Playwright: ${url}`);

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  try {
    const page = context.pages()[0] || await context.newPage();

    // Collect video URLs from network requests
    const videoUrls = [];

    page.on('response', async (response) => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';

      const isVideoPattern = contentType.includes('video/') ||
        responseUrl.includes('.mp4') ||
        responseUrl.includes('/video/') ||
        responseUrl.includes('sns-video') ||
        responseUrl.includes('sns-v');

      const isImage = contentType.includes('image/') || 
        responseUrl.match(/\.(jpg|jpeg|png|webp|gif)/i);

      if (isVideoPattern && !isImage) {
        videoUrls.push({
          url: responseUrl,
          contentType,
          size: parseInt(response.headers()['content-length'] || '0'),
        });
      }
    });

    // Navigate to the video page
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to click play button if video doesn't autoplay
    try {
      const playBtn = await page.$('[class*="play"], button[aria-label*="play"], .xgplayer-start');
      if (playBtn) {
        await playBtn.click();
        await page.waitForTimeout(3000);
      }
    } catch {
      // Ignore — video might autoplay
    }

    // Also try to extract video URL from page source
    const pageVideoUrl = await page.evaluate(() => {
      // Check video elements
      const videoEl = document.querySelector('video');
      if (videoEl?.src) return videoEl.src;

      // Check source elements
      const sourceEl = document.querySelector('video source');
      if (sourceEl?.src) return sourceEl.src;

      // Check xgplayer (common Chinese video player)
      const xgVideo = document.querySelector('.xgplayer video');
      if (xgVideo?.src) return xgVideo.src;

      // Check for meta tags with video URL
      const ogVideo = document.querySelector('meta[property="og:video"]');
      if (ogVideo?.content) return ogVideo.content;

      return null;
    });

    if (pageVideoUrl) {
      videoUrls.push({ url: pageVideoUrl, contentType: 'video/mp4', size: 0 });
    }

    if (videoUrls.length === 0) {
      throw new Error('No video URL found on the page');
    }

    // Pick the best video URL (largest file or mp4 preferred)
    const bestVideo = videoUrls
      .filter(v => v.url.startsWith('http'))
      .sort((a, b) => {
        // Prefer mp4
        const aIsMp4 = a.url.includes('.mp4') || a.contentType.includes('mp4') ? 1 : 0;
        const bIsMp4 = b.url.includes('.mp4') || b.contentType.includes('mp4') ? 1 : 0;
        if (aIsMp4 !== bIsMp4) return bIsMp4 - aIsMp4;
        // Then by size
        return b.size - a.size;
      })[0];

    logger.debug(`Best video URL: ${bestVideo.url.substring(0, 100)}...`);

    // Download the video file
    const response = await fetch(bestVideo.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': url,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Failed to download video`);
    }

    const fileStream = createWriteStream(outputPath);
    await pipeline(response.body, fileStream);

    logger.success(`Downloaded: ${outputPath}`);
    return outputPath;

  } finally {
    await context.close();
  }
}

/**
 * Parse a cookie string into Playwright cookie objects.
 */
function parseCookieString(cookieStr, url) {
  const urlObj = new URL(url);
  const domain = urlObj.hostname.includes('rednote.com') ? '.rednote.com' : '.xiaohongshu.com';

  return cookieStr.split(';').map(pair => {
    const [name, ...valueParts] = pair.trim().split('=');
    return {
      name: name.trim(),
      value: valueParts.join('=').trim(),
      domain,
      path: '/',
    };
  }).filter(c => c.name);
}
