#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import config from '../config/default.js';
import logger from './utils/logger.js';
import { ensureDirectories, cleanTemp, cleanCache } from './utils/fileManager.js';
import { printSummary } from './utils/progress.js';
import { crawlChannel, loginToRedNote } from './crawler/rednote.js';
import { downloadVideo } from './downloader/index.js';
import { processVideo, processChannel, loadPipelineState, savePipelineState } from './pipeline.js';
import { translateSrt } from './translator/index.js';
import { burnSubtitles } from './video/subtitle.js';
import { addTtsVoiceover } from './video/tts.js';
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
// process-channel: Full pipeline for an entire channel
// ─────────────────────────────────────────────────────────
program
  .command('process-channel')
  .description('Full pipeline: crawl channel → download → transcribe → translate → render')
  .argument('<url>', 'RedNote channel/user profile URL')
  .option('--skip-ocr', 'Skip OCR text extraction', false)
  .option('--skip-tts', 'Skip TTS voiceover generation', false)
  .option('--limit <n>', 'Maximum number of videos to process', parseInt)
  .option('--resume', 'Resume from last processed video', false)
  .option('--debug', 'Enable debug logging', false)
  .action(async (url, options) => {
    try {
      if (options.debug) logger.setLevel('debug');
      await ensureDirectories();

      // Step 1: Crawl channel
      logger.divider('Crawling Channel');
      const crawlLimit = (options.limit && options.limit > 0) ? options.limit : 0;
      const videos = await crawlChannel(url, { limit: crawlLimit });

      if (videos.length === 0) {
        logger.error('No videos found in channel');
        process.exit(1);
      }

      // Resume support
      let videosToProcess = videos;
      if (options.resume) {
        const processedIds = await loadPipelineState(url);
        videosToProcess = videos.filter(v => !processedIds.includes(v.noteId));
        logger.info(`Resuming: ${videosToProcess.length} remaining (${processedIds.length} already processed)`);
      }

      // Apply limit (final safety — crawlChannel may have returned extras)
      if (options.limit && options.limit > 0) {
        videosToProcess = videosToProcess.slice(0, options.limit);
      }

      logger.info(`Will process ${videosToProcess.length} video(s)`);

      // Step 2: Process each video
      const results = await processChannel(videosToProcess, {
        skipOcr: options.skipOcr,
        skipTts: options.skipTts,
      });

      // Save state for resume
      const processedIds = results
        .filter(r => r.success)
        .map(r => videosToProcess.find(v => (v.title || v.noteId) === r.title)?.noteId)
        .filter(Boolean);

      const previousIds = options.resume ? await loadPipelineState(url) : [];
      await savePipelineState(url, [...previousIds, ...processedIds]);

      // Summary
      printSummary(results);

      // Clean up temporary files
      await cleanTemp();
      if (options.cleanAll) {
        await cleanCache();
        logger.info('Cache directories (transcripts, translated) cleaned up');
      }
      logger.info('Temporary files cleaned up');

    } catch (err) {
      logger.error(`Fatal error: ${err.message}`);
      if (options.debug) console.error(err);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// process-local: Process local videos
// ─────────────────────────────────────────────────────────
program
  .command('process-local')
  .description('Process local video files from a directory')
  .argument('<dir>', 'Directory containing local video files')
  .option('--skip-ocr', 'Skip OCR text extraction', false)
  .option('--skip-tts', 'Skip TTS voiceover generation', false)
  .option('--clean-all', 'Clear all files in temp, transcripts, and translated directories after finishing', false)
  .option('--debug', 'Enable debug logging', false)
  .action(async (dir, options) => {
    try {
      if (options.debug) logger.setLevel('debug');
      await ensureDirectories();
      const { readdir } = await import('fs/promises');
      const { join, basename, extname, resolve } = await import('path');

      const fullDir = resolve(dir);
      const files = await readdir(fullDir);
      const mp4Files = files.filter(f => f.endsWith('.mp4'));

      if (mp4Files.length === 0) {
        logger.error(`No .mp4 files found in ${fullDir}`);
        process.exit(1);
      }

      logger.info(`Found ${mp4Files.length} video(s) to process in ${fullDir}`);
      const results = [];

      for (let i = 0; i < mp4Files.length; i++) {
        const fileName = mp4Files[i];
        const videoPath = join(fullDir, fileName);

        // Extract ID from name like "10_69c40899000000001a02f4e5.mp4"
        const noteIdMatch = fileName.match(/_([a-f0-9]{24})\.mp4$/) || fileName.match(/^([a-f0-9]+)/);
        const noteId = noteIdMatch ? noteIdMatch[1] : `local_${Date.now()}`;
        const title = basename(fileName, extname(fileName));

        logger.divider(`Video ${i + 1} of ${mp4Files.length}`);
        const result = await processVideo(
          { noteId, title, url: 'local' },
          { skipDownload: true, videoPath, skipOcr: options.skipOcr, skipTts: options.skipTts }
        );
        results.push(result);
      }

      printSummary(results);

      // Clean up temporary files
      await cleanTemp();
      if (options.cleanAll) {
        await cleanCache();
        logger.info('Cache directories (transcripts, translated) cleaned up');
      }
      logger.info('Temporary files cleaned up');

    } catch (err) {
      logger.error(`Fatal error: ${err.message}`);
      if (options.debug) console.error(err);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────
// process-video: Full pipeline for a single video URL
// ─────────────────────────────────────────────────────────
program
  .command('process-video')
  .description('Full pipeline for a single RedNote video')
  .argument('<url>', 'RedNote video URL')
  .option('--skip-ocr', 'Skip OCR text extraction', false)
  .option('--skip-tts', 'Skip TTS voiceover generation', false)
  .option('--clean-all', 'Clear all files in temp, transcripts, and translated directories after finishing', false)
  .option('--debug', 'Enable debug logging', false)
  .action(async (url, options) => {
    try {
      if (options.debug) logger.setLevel('debug');
      await ensureDirectories();

      // Extract note ID from URL
      const noteIdMatch = url.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
      const noteId = noteIdMatch ? noteIdMatch[1] : `video_${Date.now()}`;

      const result = await processVideo(
        { noteId, title: '', url },
        { skipOcr: options.skipOcr, skipTts: options.skipTts }
      );

      printSummary([result]);

      // Clean up temporary files
      await cleanTemp();
      if (options.cleanAll) {
        await cleanCache();
        logger.info('Cache directories (transcripts, translated) cleaned up');
      }
      logger.info('Temporary files cleaned up');

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
