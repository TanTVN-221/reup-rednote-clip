import { chromium } from 'playwright';
import config from '../../config/default.js';
import logger from '../utils/logger.js';

/**
 * Crawl a RedNote user profile to discover all video note URLs.
 *
 * @param {string} channelUrl - The RedNote user profile URL
 * @returns {Promise<Array<{noteId: string, title: string, url: string}>>}
 */
export async function crawlChannel(channelUrl) {
  logger.info(`Crawling channel: ${channelUrl}`);

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    // Set cookies if available
    if (config.rednote.cookie) {
      const cookies = parseCookieString(config.rednote.cookie, channelUrl);
      await context.addCookies(cookies);
    }

    const page = await context.newPage();
    await page.goto(channelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll to load all videos
    const videos = new Map(); // noteId -> {title, url}
    let previousCount = 0;
    let noNewContentCount = 0;

    for (let i = 0; i < config.rednote.maxScrolls; i++) {
      // Extract video notes from the current page state
      const newNotes = await page.evaluate(() => {
        const notes = [];
        // RedNote uses various selectors for note cards
        const selectors = [
          'a[href*="/explore/"]',
          'a[href*="/discovery/item/"]',
          'section.note-item a',
          '.note-item a',
          '[class*="note"] a[href*="explore"]',
        ];

        for (const selector of selectors) {
          const links = document.querySelectorAll(selector);
          for (const link of links) {
            const href = link.getAttribute('href');
            if (!href) continue;

            // Extract note ID from URL
            const match = href.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
            if (match) {
              const noteId = match[1];
              // Try to get title from various elements
              const titleEl = link.querySelector('.title, .desc, [class*="title"], [class*="desc"]');
              const title = titleEl?.textContent?.trim() || '';
              // Check if it has a video indicator
              const hasVideo = link.querySelector('[class*="video"], [class*="play"], svg[class*="play"]') !== null;
              notes.push({
                noteId,
                title,
                url: href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`,
                hasVideo,
              });
            }
          }
        }
        return notes;
      });

      // Add new notes to our collection
      for (const note of newNotes) {
        if (!videos.has(note.noteId)) {
          videos.set(note.noteId, note);
        }
      }

      // Check if we got new content
      if (videos.size === previousCount) {
        noNewContentCount++;
        if (noNewContentCount >= 3) {
          logger.info(`No new content after ${noNewContentCount} scrolls, stopping`);
          break;
        }
      } else {
        noNewContentCount = 0;
        previousCount = videos.size;
        logger.debug(`Found ${videos.size} notes so far...`);
      }

      // Scroll down
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(config.rednote.scrollDelay);
    }

    const result = Array.from(videos.values());

    // Filter to only video notes if possible
    const videoNotes = result.filter(n => n.hasVideo);
    const finalList = videoNotes.length > 0 ? videoNotes : result;

    logger.success(`Found ${finalList.length} video(s) in channel`);
    return finalList;

  } finally {
    await browser.close();
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

export default { crawlChannel };
