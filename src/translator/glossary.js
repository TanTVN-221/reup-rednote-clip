import { readFile, writeFile } from 'fs/promises';
import { createReadStream } from 'fs';
import config from '../../config/default.js';
import logger from '../utils/logger.js';

/**
 * Load the glossary from config/glossary.json.
 * Returns a sorted array of entries (longest terms first for greedy matching).
 */
export async function loadGlossary() {
  try {
    const content = await readFile(config.glossaryPath, 'utf-8');
    const raw = JSON.parse(content);

    // Filter out comment keys and sort by length (longest first for greedy matching)
    const entries = Object.entries(raw)
      .filter(([key]) => !key.startsWith('_'))
      .sort((a, b) => b[0].length - a[0].length);

    logger.debug(`Loaded glossary with ${entries.length} terms`);
    return entries;
  } catch (err) {
    logger.warn(`Could not load glossary: ${err.message}`);
    return [];
  }
}

/**
 * Replace Chinese technical terms with English equivalents before translation.
 * Uses placeholder markers to protect them from being translated.
 *
 * @param {string} text - Chinese text
 * @param {Array<[string, string]>} glossary - Sorted glossary entries
 * @returns {{ processed: string, replacements: Map<string, string> }}
 */
export function applyGlossaryPreTranslation(text, glossary) {
  let processed = text;
  const replacements = new Map();
  let placeholderIndex = 0;

  for (const [chinese, english] of glossary) {
    if (processed.includes(chinese)) {
      // Use a unique placeholder that Google Translate won't touch
      const placeholder = `⟦TERM${placeholderIndex}⟧`;
      // Replace all occurrences
      processed = processed.split(chinese).join(placeholder);
      replacements.set(placeholder, english);
      placeholderIndex++;
    }
  }

  return { processed, replacements };
}

/**
 * Restore English technical terms after translation.
 *
 * @param {string} translatedText - Translated text with placeholders
 * @param {Map<string, string>} replacements - Placeholder → English term mapping
 * @returns {string}
 */
export function applyGlossaryPostTranslation(translatedText, replacements) {
  let result = translatedText;

  for (const [placeholder, english] of replacements) {
    // Also handle cases where the translator might have modified the placeholder slightly
    const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPlaceholder, 'g');
    result = result.replace(regex, english + " ");
  }

  return result;
}

/**
 * Add a new term to the glossary.
 *
 * @param {string} chinese - Chinese term
 * @param {string} english - English translation
 */
export async function addGlossaryTerm(chinese, english) {
  const content = await readFile(config.glossaryPath, 'utf-8');
  const glossary = JSON.parse(content);

  glossary[chinese] = english;

  await writeFile(config.glossaryPath, JSON.stringify(glossary, null, 2), 'utf-8');
  logger.success(`Added glossary term: ${chinese} → ${english}`);
}

/**
 * List all glossary terms.
 *
 * @returns {Array<{chinese: string, english: string}>}
 */
export async function listGlossaryTerms() {
  const content = await readFile(config.glossaryPath, 'utf-8');
  const raw = JSON.parse(content);

  return Object.entries(raw)
    .filter(([key]) => !key.startsWith('_'))
    .map(([chinese, english]) => ({ chinese, english }));
}

export default {
  loadGlossary,
  applyGlossaryPreTranslation,
  applyGlossaryPostTranslation,
  addGlossaryTerm,
  listGlossaryTerms,
};
