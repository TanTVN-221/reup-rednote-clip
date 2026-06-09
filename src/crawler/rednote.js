import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import config from '../../config/default.js';
import logger from '../utils/logger.js';

chromium.use(stealth());

const BROWSER_DATA_DIR = path.resolve('data', '.browser-profile');

/**
 * Launch a persistent browser context that saves cookies/session across runs.
 */
async function launchPersistentBrowser(options = {}) {
  const { headless = false } = options;

  if (!fs.existsSync(BROWSER_DATA_DIR)) {
    fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  return context;
}

/**
 * Interactive login flow: opens a visible browser for the user to log in manually.
 */
export async function loginToRedNote() {
  logger.info('Opening browser for RedNote login...');
  logger.info('Please log in manually. The browser will close automatically once login is detected.');

  const context = await launchPersistentBrowser({ headless: false });
  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://www.rednote.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  logger.info('Waiting for login... (you have 5 minutes)');

  try {
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || '';
      return !bodyText.includes('Log in to view') && !bodyText.includes('Scan QR code');
    }, { timeout: 300000 });

    logger.success('Login detected! Session saved.');
  } catch (err) {
    logger.warn('Login timeout. Please try again with: node src/cli.js login');
  }

  await context.close();
}

/**
 * Crawl a RedNote user profile to discover all video note URLs.
 * 
 * Opens a visible browser (required by RedNote's anti-bot), logs in if needed,
 * then scrolls through the profile to extract all video notes.
 * 
 * When no limit is set, scrolls until the entire channel is exhausted.
 *
 * @param {string} channelUrl - The RedNote user profile URL
 * @param {object} [options] - Crawl options
 * @param {number} [options.limit] - Max number of videos to return (0 or undefined = all)
 * @returns {Promise<Array<{noteId: string, title: string, url: string}>>}
 */
export async function crawlChannel(channelUrl, options = {}) {
  const { limit = 0 } = options;
  logger.info(`Crawling channel: ${channelUrl}`);

  // Extract user ID from URL
  const userIdMatch = channelUrl.match(/profile\/([a-f0-9]+)/);
  if (!userIdMatch) {
    logger.error('Invalid channel URL. Expected format: .../user/profile/<userId>');
    return [];
  }
  const userId = userIdMatch[1];

  // Must use visible browser — headless mode is detected by RedNote
  const context = await launchPersistentBrowser({ headless: false });

  try {
    const page = context.pages()[0] || await context.newPage();

    const videos = new Map();

    // Intercept API responses to capture video note IDs
    page.on('response', async (response) => {
      try {
        const respUrl = response.url();
        if (respUrl.includes('/api/sns/web/v1/user_posted') && response.status() === 200) {
          const json = await response.json();
          const items = json.data?.notes || [];
          for (const item of items) {
            if (item.note_id) {
              const hasVideo = item.type === 'video';
              const xsecToken = item.xsec_token || '';
              const fullUrl = xsecToken 
                ? `https://www.rednote.com/explore/${item.note_id}?xsec_token=${xsecToken}&xsec_source=pc_user` 
                : `https://www.rednote.com/explore/${item.note_id}`;

              if (!videos.has(item.note_id)) {
                videos.set(item.note_id, {
                  noteId: item.note_id,
                  title: item.display_title || '',
                  url: fullUrl,
                  hasVideo,
                  isTop: item.is_top === true || item.is_top === 'true',
                  xsecToken,
                });
                logger.debug(`[API] Found: ${item.display_title || item.note_id} (${item.type}) [Pinned: ${item.is_top ? 'yes' : 'no'}]`);
              }
            }
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    const profileUrl = `https://www.rednote.com/user/profile/${userId}`;
    logger.info(`Opening profile: ${profileUrl}`);

    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if we need to log in
    const needsLogin = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Log in to view') || text.includes('Scan QR code');
    });

    if (needsLogin) {
      logger.warn('Login required. Please log in in the browser window...');
      logger.info('Waiting for login... (you have 5 minutes)');

      try {
        await page.waitForFunction(() => {
          const text = document.body?.innerText || '';
          return !text.includes('Log in to view') && !text.includes('Scan QR code');
        }, { timeout: 300000 });

        logger.success('Login successful!');
        await page.waitForTimeout(3000);
      } catch {
        logger.error('Login timeout. Please run: node src/cli.js login');
        return [];
      }
    }

    // Check for IP ban
    const isBanned = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('安全限制') || text.includes('300012');
    });
    if (isBanned) {
      logger.error('IP banned by RedNote (Error 300012). Try restarting your router.');
      return [];
    }

    logger.info('Page loaded. Collecting notes...');

    // Wait for initial page render
    await page.waitForTimeout(3000);

    // Helper: extract notes from the current DOM state
    const extractDomNotes = async () => {
      return page.evaluate(() => {
        const extracted = [];
        const links = document.querySelectorAll('a.cover[href*="/user/profile/"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          const match = href.match(/\/user\/profile\/[a-f0-9]+\/([a-f0-9]{24})/);
          if (match) {
            const noteId = match[1];
            const noteContainer = link.closest('.note-item, [class*="note"]');
            const titleEl = noteContainer?.querySelector('.title, [class*="title"], [class*="desc"]');
            const title = titleEl?.textContent?.trim() || '';
            const hasVideo = !!noteContainer?.querySelector('.play-icon, [class*="video-icon"]');
            const tokenMatch = href.match(/xsec_token=([^&]+)/);
            const xsecToken = tokenMatch ? tokenMatch[1] : '';
            const fullUrl = xsecToken 
              ? `https://www.rednote.com/explore/${noteId}?xsec_token=${xsecToken}&xsec_source=pc_user` 
              : `https://www.rednote.com/explore/${noteId}`;
            extracted.push({ noteId, title, url: fullUrl, hasVideo, xsecToken });
          }
        }
        return extracted;
      });
    };

    // Step 1: Extract SSR-rendered notes from DOM FIRST (these are the newest posts
    // that RedNote bakes into the HTML — the API interceptor never sees them)
    const initialDomNotes = await extractDomNotes();
    for (const note of initialDomNotes) {
      if (!videos.has(note.noteId)) {
        videos.set(note.noteId, note);
      }
    }
    if (initialDomNotes.length > 0) {
      logger.info(`Found ${initialDomNotes.length} initial notes from page (SSR)`);
    }

    // Step 2: Scroll to trigger API calls and load all remaining notes
    // When limit is set, we can stop early once we have enough video notes.
    // When no limit is set (limit=0), scroll until the channel is fully exhausted.
    let previousCount = videos.size;
    let noNewContentCount = 0;
    const scrollDelay = config.rednote_settings?.scrollDelay || 2000;
    const maxEmptyScrolls = 5;  // stop after 5 consecutive scrolls with no new content
    let scrollCount = 0;

    while (true) {
      // If limit is set and we already have enough video notes, stop scrolling
      if (limit > 0) {
        const currentVideoCount = Array.from(videos.values()).filter(n => n.hasVideo).length;
        if (currentVideoCount >= limit) {
          logger.info(`Reached limit of ${limit} videos, stopping scroll`);
          break;
        }
      }

      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(scrollDelay);
      scrollCount++;

      // Also pick up any new DOM nodes rendered by scrolling
      const scrollDomNotes = await extractDomNotes();
      for (const note of scrollDomNotes) {
        if (!videos.has(note.noteId)) {
          videos.set(note.noteId, note);
        }
      }

      // Check if the page shows an "end of content" indicator
      const reachedEnd = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.includes('没有更多了') || text.includes('已经到底了') || text.includes('No more content');
      });
      if (reachedEnd) {
        logger.info('Reached end of channel content');
        break;
      }

      if (videos.size === previousCount) {
        noNewContentCount++;
        if (noNewContentCount >= maxEmptyScrolls) {
          logger.info(`No new content after ${noNewContentCount} scrolls, channel fully loaded`);
          break;
        }
      } else {
        noNewContentCount = 0;
        previousCount = videos.size;
        logger.info(`Found ${videos.size} notes so far... (scroll #${scrollCount})`);
      }
    }

    // Filter to video notes only
    const result = Array.from(videos.values());
    const videoNotes = result.filter(n => n.hasVideo);
    let finalList = videoNotes.length > 0 ? videoNotes : result;

    // Sort newest first by noteId (first 8 hex chars encode Unix timestamp)
    finalList.sort((a, b) => b.noteId.localeCompare(a.noteId));

    if (finalList.length === 0) {
      logger.warn('No videos found in channel.');
    } else {
      logger.success(`Found ${finalList.length} video(s) in channel`);
    }

    return finalList;

  } finally {
    await context.close();
  }
}

export default { crawlChannel, loginToRedNote };
