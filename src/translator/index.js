import { readFile, writeFile } from 'fs/promises';
import { translateWithGemini } from './gemini.js';
import logger from '../utils/logger.js';

/**
 * Translate an SRT file from Chinese to Vietnamese using Gemini API.
 *
 * @param {string} inputSrtPath - Path to the Chinese SRT file
 * @param {string} outputSrtPath - Where to save the translated SRT
 * @returns {Promise<string>} Path to the translated SRT file
 */
export async function translateSrt(inputSrtPath, outputSrtPath) {
  logger.info(`Translating SRT using Gemini: ${inputSrtPath}`);

  const srtContent = await readFile(inputSrtPath, 'utf-8');

  if (!srtContent || srtContent.trim().length === 0) {
    logger.warn('Empty SRT file, nothing to translate');
    await writeFile(outputSrtPath, '', 'utf-8');
    return outputSrtPath;
  }

  try {
    let translatedSrt = await translateWithGemini(srtContent);
    
    // Fix: Enforce original timestamps and strict SRT formatting
    // Gemini often messes up timestamp formatting (e.g. replacing . with : or dropping digits)
    const originalBlocks = parseSrt(srtContent);
    const translatedBlocks = parseSrt(translatedSrt);

    if (originalBlocks.length > 0 && translatedBlocks.length > 0) {
      // Create a map of original blocks by index
      const originalMap = {};
      for (const block of originalBlocks) {
        originalMap[block.index] = block;
      }

      // Restore original timecodes to the translated blocks and normalize to commas
      for (const tBlock of translatedBlocks) {
        const origBlock = originalMap[tBlock.index];
        if (origBlock) {
          // Force standard SRT format: replace any periods with commas
          tBlock.timecode = origBlock.timecode.replace(/\./g, ',');
        } else {
          // If Gemini fabricated an index, at least fix its punctuation
          tBlock.timecode = tBlock.timecode.replace(/\./g, ',').replace(/(\d{2}):(\d{3})/, '$1,$2');
        }
      }
      
      translatedSrt = buildSrt(translatedBlocks);
    }

    await writeFile(outputSrtPath, translatedSrt, 'utf-8');
    logger.success(`Translation saved: ${outputSrtPath}`);
    return outputSrtPath;
  } catch (err) {
    logger.error(`Failed to translate SRT: ${err.message}`);
    throw err;
  }
}

/**
 * Parse SRT content into structured blocks.
 */
function parseSrt(srtContent) {
  const blocks = [];
  const parts = srtContent.trim().split(/\n\n+/);

  for (const part of parts) {
    const lines = part.trim().split('\n');
    if (lines.length >= 3) {
      blocks.push({
        index: parseInt(lines[0]),
        timecode: lines[1],
        text: lines.slice(2).join('\n'),
      });
    } else if (lines.length === 2) {
      blocks.push({
        index: parseInt(lines[0]),
        timecode: lines[1],
        text: '',
      });
    }
  }

  return blocks;
}

/**
 * Build SRT content from structured blocks.
 */
function buildSrt(blocks) {
  return blocks
    .map((block) => `${block.index}\n${block.timecode}\n${block.text}`)
    .join('\n\n') + '\n';
}

export default { translateSrt };
