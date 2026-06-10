#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import config from '../config/default.js';
import logger from './utils/logger.js';
import { ensureDirectories, cleanAllTempFiles } from './utils/fileManager.js';
import { printSummary } from './utils/progress.js';
import { crawlChannel, loginToRedNote } from './crawler/rednote.js';
import { downloadVideo } from './downloader/index.js';
import { processVideo, processChannel, loadPipelineState, loadPipelineVideos, savePipelineState } from './pipeline.js';
import { translateSrt } from './translator/index.js';
import { burnSubtitles } from './video/subtitle.js';
import { addTtsVoiceover } from './video/tts.js';
import { uploadToTikTok } from './uploader/zernio.js';
import { addGlossaryTerm, listGlossaryTerms } from './translator/glossary.js';

const program = new Command();

// Banner
const BANNER = `
${chalk.red('╔═══════════════════════════════════════════════════╗')}
${chalk.red('║')}  ${chalk.bold.white('🎬 RedNote Clip Downloader & Translator')}          ${chalk.red('║')}
${chalk.red('║')}  ${chalk.gray('Download · Transcribe · Translate · Re-upload')}    ${chalk.red('║')}
${chalk.red('╚═══════════════════════════════════════════════════╝')}
`;

program
  .name('rednote')
  .description('Download RedNote clips, translate Chinese→Vietnamese, and re-upload to TikTok')
  .version('1.0.0')
  .hook('preAction', () => {
    console.log(BANNER);
  });

// ─────────────────────────────────────────────────────────
// process: Smart pipeline (auto-detects channel, video, or local dir)
// ─────────────────────────────────────────────────────────
program
  .command('process')
  .description('Process videos from a RedNote URL (channel/video) or a local directory')
  .argument('<input>', 'RedNote URL or local directory path')
  .option('--skip-ocr', 'Skip OCR text extraction', false)
  .option('--skip-tts', 'Skip TTS voiceover generation', false)
  .option('--limit <n>', 'Maximum number of NEW videos to process (channels/directories only)', parseInt)
  .option('--force', 'Re-process all videos (ignore previously processed)', false)
  .option('--schedule <time>', 'Schedule upload time (ISO format, e.g. 2024-11-01T10:00:00Z)')
  .option('--schedule-interval <minutes>', 'If videos you need to publish to Tiktok is so much, zernito will reach Interval in minutes between scheduled uploads for subsequent videos', parseInt)
  .option('--upload', 'Automatically upload to TikTok via Zernio after processing', false)
  .option('--draft', 'Upload video as a draft in Zernito instead of publishing immediately. You can go to Zernito Dashboard to manage draft videos.', false)
  .option('--delay <seconds>', 'Delay between uploads in seconds to avoid rate limits', parseInt, 30)
  .option('--debug', 'Enable debug logging', false)
  .action(async (input, options) => {
    try {
      if (options.debug) logger.setLevel('debug');
      await ensureDirectories();

      let isChannel = false;
      let isSingleVideo = false;
      let isLocalDir = false;

      // Auto-detect input type
      if (input.includes('profile/')) {
        isChannel = true;
      } else if (input.includes('explore/') || input.includes('discovery/')) {
        isSingleVideo = true;
      } else {
        // Check if it's a valid local directory
        try {
          const { stat } = await import('fs/promises');
          const stats = await stat(input);
          if (stats.isDirectory()) {
            isLocalDir = true;
          } else {
            throw new Error('Not a directory');
          }
        } catch {
          logger.error('Input is not a valid RedNote URL or local directory.');
          process.exit(1);
        }
      }

      let results = [];
      let stateKey = null;

      if (isChannel) {
        logger.divider('Processing Channel');
        const userIdMatch = input.match(/profile\/([a-f0-9]+)/);
        stateKey = userIdMatch ? userIdMatch[1] : input;

        const videos = await crawlChannel(input, { limit: 0 }); // crawl all first
        if (videos.length === 0) {
          logger.error('No videos found in channel');
          process.exit(1);
        }

        let videosToProcess = videos;
        const previousIds = await loadPipelineState(stateKey);

        if (!options.force && previousIds.length > 0) {
          videosToProcess = videos.filter(v => !previousIds.includes(v.noteId));
          logger.info(`Skipping ${previousIds.length} already processed video(s)`);
        }

        if (videosToProcess.length === 0) {
          logger.info('✅ No new videos to process. Everything is up to date!');
          return;
        }

        if (options.limit && options.limit > 0) {
          // Push pinned videos to the end to ensure the limit slice prioritizes the chronologically newest unpinned videos
          videosToProcess.sort((a, b) => {
            if (a.isTop && !b.isTop) return 1;
            if (!a.isTop && b.isTop) return -1;
            return 0;
          });
          videosToProcess = videosToProcess.slice(0, options.limit);
        }

        logger.info(`Will process ${videosToProcess.length} new video(s)`);

        results = await processChannel(videosToProcess, {
          skipOcr: options.skipOcr,
          skipTts: options.skipTts,
        });

      } else if (isSingleVideo) {
        logger.divider('Processing Single Video');
        const noteIdMatch = input.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
        const noteId = noteIdMatch ? noteIdMatch[1] : `video_${Date.now()}`;
        stateKey = noteId; // For state saving

        const result = await processVideo(
          { noteId, title: '', url: input },
          { skipOcr: options.skipOcr, skipTts: options.skipTts }
        );
        results = [result];

      } else if (isLocalDir) {
        logger.divider('Processing Local Directory');
        const { readdir } = await import('fs/promises');
        const { join, basename, extname, resolve } = await import('path');
        const fullDir = resolve(input);
        const files = await readdir(fullDir);
        const mp4Files = files.filter(f => f.endsWith('.mp4'));

        if (mp4Files.length === 0) {
          logger.error(`No .mp4 files found in ${fullDir}`);
          process.exit(1);
        }

        // We use the absolute path of the directory as the state key
        stateKey = fullDir;

        let filesToProcess = mp4Files;
        const previousIds = await loadPipelineState(stateKey);

        if (!options.force && previousIds.length > 0) {
          // For local files, the 'noteId' is typically extracted from the filename
          filesToProcess = mp4Files.filter(fileName => {
            const noteIdMatch = fileName.match(/_([a-f0-9]{24})\.mp4$/) || fileName.match(/^([a-f0-9]+)/);
            const noteId = noteIdMatch ? noteIdMatch[1] : basename(fileName, '.mp4');
            return !previousIds.includes(noteId);
          });
          logger.info(`Skipping ${mp4Files.length - filesToProcess.length} already processed video(s)`);
        }

        if (filesToProcess.length === 0) {
          logger.info('✅ No new videos to process in this directory.');
          return;
        }

        if (options.limit && options.limit > 0) {
          filesToProcess = filesToProcess.slice(0, options.limit);
        }

        logger.info(`Found ${filesToProcess.length} new video(s) to process in ${fullDir}`);

        for (let i = 0; i < filesToProcess.length; i++) {
          const fileName = filesToProcess[i];
          const videoPath = join(fullDir, fileName);

          const noteIdMatch = fileName.match(/_([a-f0-9]{24})\.mp4$/) || fileName.match(/^([a-f0-9]+)/);
          const noteId = noteIdMatch ? noteIdMatch[1] : basename(fileName, extname(fileName));
          const title = basename(fileName, extname(fileName));

          logger.divider(`Video ${i + 1} of ${filesToProcess.length}`);
          const result = await processVideo(
            { noteId, title, url: 'local' },
            { skipDownload: true, videoPath, skipOcr: options.skipOcr, skipTts: options.skipTts }
          );
          results.push(result);
        }
      }

      // Always save state (append newly processed entries with metadata)
      if (stateKey) {
        const previousEntries = await loadPipelineVideos(stateKey);
        const newEntries = results
          .filter(r => r.success)
          .map((r, index) => {
            // Re-resolve original noteId for single videos or local files if needed, but r.title or r.url usually hold enough info
            const noteIdMatch = r.url?.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
            const fallbackNoteId = noteIdMatch ? noteIdMatch[1] : r.title;

            return {
              uploadTiktokStatus: false,
              noteId: fallbackNoteId,
              title: r.title,
              publishTime: r.caption?.publishTime || null,
              outputPath: r.outputPath || null,
              captionPath: r.captionPath || null,
              processedAt: new Date().toISOString(),
            };
          });

        await savePipelineState(stateKey, [...previousEntries, ...newEntries]);
      }

      printSummary(results);

      // Auto-upload
      if (options.upload && stateKey) {
        await uploadPendingVideos(stateKey, options);
      }

    } catch (err) {
      logger.error(`Fatal error: ${err.message}`);
      if (options.debug) console.error(err);
      process.exitCode = 1;
    } finally {
      await cleanAllTempFiles();
    }
  });

async function uploadPendingVideos(stateKey, options) {
  logger.divider('Uploading to TikTok via Zernio');
  const { readFile } = await import('fs/promises');

  // Load the latest state so we can mutate and save it
  const allEntries = await loadPipelineVideos(stateKey);

  // Filter for ANY video that has been processed but not uploaded yet
  let pendingUploads = allEntries.filter(entry => entry.outputPath && entry.uploadTiktokStatus === false);

  if (pendingUploads.length === 0) {
    logger.info('✅ No pending videos to upload.');
  } else {
    logger.info(`Found ${pendingUploads.length} video(s) ready to upload.`);
    logger.info('Videos will be uploaded in chronological order (oldest publishTime first).');

    // Sort all entries by publishTime to calculate the correct global order
    const sortedEntries = [...allEntries].sort((a, b) => (a.publishTime || 0) - (b.publishTime || 0));

    for (let i = 0; i < pendingUploads.length; i++) {
      const entry = pendingUploads[i];

      logger.divider(`Uploading ${i + 1} of ${pendingUploads.length}: ${entry.noteId}`);

      let captionData = {};
      if (entry.captionPath) {
        try {
          const content = await readFile(entry.captionPath, 'utf-8');
          captionData = JSON.parse(content);
        } catch (err) {
          logger.warn(`Could not read caption JSON at ${entry.captionPath}`);
        }
      }

      let currentScheduleTime = options.schedule;

      if (options.scheduleInterval && options.scheduleInterval > 0) {
        if (i === 0 && !options.schedule) {
          // first video publishes immediately
          currentScheduleTime = undefined;
        } else {
          const baseDate = options.schedule ? new Date(options.schedule) : new Date();
          const offsetMs = i * options.scheduleInterval * 60 * 1000;
          currentScheduleTime = new Date(baseDate.getTime() + offsetMs).toISOString();
        }
      }

      const uploadResult = await uploadToTikTok(entry.outputPath, captionData, {
        isDraft: options.draft,
        scheduleTime: currentScheduleTime,
        orderOfVideo: entry.orderOfVideo
      });

      if (uploadResult.success) {
        // Find and update the entry in the state
        const entryIndex = allEntries.findIndex(e => e.noteId === entry.noteId);
        if (entryIndex !== -1) {
          allEntries[entryIndex].zernioPostId = uploadResult.postId;
          allEntries[entryIndex].uploadedAt = new Date().toISOString();
          allEntries[entryIndex].uploadTiktokStatus = true;
          await savePipelineState(stateKey, allEntries);
        }

        if (i < pendingUploads.length - 1) {
          const waitSeconds = options.delay || 30;
          logger.info(`Waiting ${waitSeconds} seconds before next upload to avoid rate limits...`);
          await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        }
      } else {
        if (uploadResult.error && uploadResult.error.toLowerCase().includes('rate-limit')) {
          logger.warn(`Rate limit hit: ${uploadResult.error}`);
          logger.info('Auto-pausing for 10 minutes (600 seconds) before retrying this video...');
          await new Promise(resolve => setTimeout(resolve, 600000));
          i--; // Decrement i so the loop retries the exact same video
          continue;
        }
        logger.error(`Failed to upload ${entry.noteId}. Stopping batch to preserve order.`);
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// upload: Upload processed videos to TikTok
// ─────────────────────────────────────────────────────────
program
  .command('upload')
  .description('Upload processed videos to TikTok based on pipeline state')
  .argument('<url>', 'RedNote channel or video URL')
  .option('--draft', 'Upload video as a draft instead of publishing immediately', false)
  .option('--schedule <time>', 'Schedule upload time (ISO format, e.g. 2024-11-01T10:00:00Z)')
  .option('--schedule-interval <minutes>', 'Interval in minutes between scheduled uploads for subsequent videos', parseInt)
  .option('--delay <seconds>', 'Delay between uploads in seconds to avoid rate limits', parseInt, 30)
  .option('--debug', 'Enable debug logging', false)
  .action(async (url, options) => {
    try {
      if (options.debug) logger.setLevel('debug');

      const noteIdMatch = url.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
      const profileMatch = url.match(/\/user\/profile\/([a-f0-9]+)/);
      const stateKey = profileMatch ? profileMatch[1] : (noteIdMatch ? noteIdMatch[1] : null);

      if (!stateKey) {
        logger.error('Could not extract channel or video ID from URL.');
        process.exit(1);
      }

      await uploadPendingVideos(stateKey, options);
    } catch (err) {
      logger.error(`Fatal error: ${err.message}`);
      if (options.debug) console.error(err);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// download: Download only (no translation/rendering)
// ─────────────────────────────────────────────────────────
program
  .command('download')
  .description('Download a video without processing')
  .argument('<url>', 'RedNote video URL')
  .option('--debug', 'Enable debug logging', false)
  .action(async (url, options) => {
    try {
      if (options.debug) logger.setLevel('debug');
      await ensureDirectories();

      const noteIdMatch = url.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
      const noteId = noteIdMatch ? noteIdMatch[1] : `video_${Date.now()}`;

      const videoPath = await downloadVideo(url, noteId);
      logger.success(`Downloaded: ${videoPath}`);

    } catch (err) {
      logger.error(`Download failed: ${err.message}`);
      if (options.debug) console.error(err);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// translate: Translate an existing SRT file
// ─────────────────────────────────────────────────────────
program
  .command('translate')
  .description('Translate an existing Chinese SRT file to Vietnamese')
  .argument('<srt-file>', 'Path to the SRT file')
  .option('-o, --output <path>', 'Output path for translated SRT')
  .option('--debug', 'Enable debug logging', false)
  .action(async (srtFile, options) => {
    try {
      if (options.debug) logger.setLevel('debug');

      const outputPath = options.output || srtFile.replace('.srt', '_vi.srt');
      await translateSrt(srtFile, outputPath);
      logger.success(`Translated: ${outputPath}`);

    } catch (err) {
      logger.error(`Translation failed: ${err.message}`);
      if (options.debug) console.error(err);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// render: Burn subtitles + TTS into a video
// ─────────────────────────────────────────────────────────
program
  .command('render')
  .description('Burn subtitles and add TTS voiceover to a video')
  .argument('<video>', 'Input video path')
  .argument('<srt>', 'Vietnamese SRT subtitle file')
  .option('-o, --output <path>', 'Output video path')
  .option('--skip-tts', 'Skip TTS voiceover', false)
  .option('--debug', 'Enable debug logging', false)
  .action(async (video, srt, options) => {
    try {
      if (options.debug) logger.setLevel('debug');
      await ensureDirectories();

      const outputPath = options.output || video.replace('.mp4', '_vi.mp4');

      if (options.skipTts) {
        // Just burn subtitles
        await burnSubtitles(video, srt, outputPath);
      } else {
        // Burn subtitles first
        const { getTempPath } = await import('./utils/fileManager.js');
        const tempPath = getTempPath(`render_temp_${Date.now()}.mp4`);
        await burnSubtitles(video, srt, tempPath);

        // Then add TTS
        await addTtsVoiceover(tempPath, srt, outputPath);

        // Clean up
        const { unlink } = await import('fs/promises');
        try { await unlink(tempPath); } catch { /* ignore */ }
      }

      logger.success(`Rendered: ${outputPath}`);

    } catch (err) {
      logger.error(`Render failed: ${err.message}`);
      if (options.debug) console.error(err);
      process.exit(1);
    }
  });



// ─────────────────────────────────────────────────────────
// glossary: Manage technical term glossary
// ─────────────────────────────────────────────────────────
const glossaryCmd = program
  .command('glossary')
  .description('Manage the technical term glossary');

glossaryCmd
  .command('add')
  .description('Add a Chinese→English term to the glossary')
  .argument('<chinese>', 'Chinese term')
  .argument('<english>', 'English translation')
  .action(async (chinese, english) => {
    try {
      await addGlossaryTerm(chinese, english);
    } catch (err) {
      logger.error(`Failed to add term: ${err.message}`);
      process.exit(1);
    }
  });

glossaryCmd
  .command('list')
  .description('List all glossary terms')
  .action(async () => {
    try {
      const terms = await listGlossaryTerms();
      console.log(chalk.cyan('\n📖 Glossary Terms:'));
      console.log(chalk.gray('─'.repeat(50)));

      for (const { chinese, english } of terms) {
        console.log(`  ${chalk.yellow(chinese)} → ${chalk.green(english)}`);
      }

      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.gray(`  Total: ${terms.length} terms\n`));

    } catch (err) {
      logger.error(`Failed to list terms: ${err.message}`);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// status: Show current state
// ─────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show processing status and data directory info')
  .action(async () => {
    try {
      const { readdir, stat } = await import('fs/promises');

      const dirs = {
        'Downloads': config.downloadsDir,
        'Transcripts': config.transcriptsDir,
        'Translated': config.translatedDir,
        'Output': config.outputDir,
      };

      console.log(chalk.cyan('\n📁 Data Directories:'));
      console.log(chalk.gray('─'.repeat(50)));

      for (const [name, dir] of Object.entries(dirs)) {
        try {
          const files = await readdir(dir);
          console.log(`  ${chalk.white(name)}: ${chalk.yellow(files.length)} file(s) — ${chalk.gray(dir)}`);
        } catch {
          console.log(`  ${chalk.white(name)}: ${chalk.gray('(not created yet)')}`);
        }
      }

      console.log(chalk.gray('─'.repeat(50)));

      // Show config summary
      console.log(chalk.cyan('\n⚙️  Configuration:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Whisper model: ${chalk.yellow(config.whisper.modelName)}`);
      console.log(`  TTS voice: ${chalk.yellow(config.tts.voice)}`);
      console.log(`  Original audio vol: ${chalk.yellow(config.tts.originalAudioVolume)}`);
      console.log(`  Subtitle size: ${chalk.yellow(config.subtitle.fontSize)}`);
      console.log(`  RedNote cookie: ${chalk.yellow(config.rednote.cookie ? 'Set ✓' : 'Not set ✗')}`);
      console.log(chalk.gray('─'.repeat(50)) + '\n');

    } catch (err) {
      logger.error(`Status check failed: ${err.message}`);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// login: Interactive browser login to save session
// ─────────────────────────────────────────────────────────
program
  .command('login')
  .description('Open a browser window to log in to RedNote. Session is saved for future headless use.')
  .action(async () => {
    try {
      await loginToRedNote();
    } catch (err) {
      logger.error(`Login failed: ${err.message}`);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
