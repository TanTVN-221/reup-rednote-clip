import { GoogleGenAI } from '@google/genai';
import config from '../../config/default.js';
import logger from '../utils/logger.js';
import { loadGlossary } from './glossary.js';

let aiClient = null;

function getClient() {
  if (!aiClient) {
    if (!config.gemini.apiKey) {
      throw new Error('GEMINI_API_KEY is not set in .env');
    }
    aiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return aiClient;
}

/**
 * Translate an entire SRT file content from Chinese to Vietnamese using Gemini.
 *
 * @param {string} srtContent - The original Chinese SRT text.
 * @returns {Promise<string>} The translated Vietnamese SRT text.
 */
export async function translateWithGemini(srtContent) {
  const ai = getClient();
  const glossary = await loadGlossary();

  // Format glossary for the prompt
  let glossaryText = 'None';
  const glossaryKeys = Object.keys(glossary);
  if (glossaryKeys.length > 0) {
    glossaryText = glossaryKeys.map(k => `- ${k} -> ${glossary[k]}`).join('\n');
  }

  const prompt = `Please translate the provided Chinese SRT file into Vietnamese.

Here are the specific requirements for the output:

1. Tone & Style: Adopt a narrative, conversational, and storytelling tone. Act as a friendly photo editing instructor. Use natural Vietnamese pronouns like 'mình' and 'các bạn/mọi người'.

2. Technical Terminology: Do NOT translate photography and color grading technical terms into Vietnamese. You must keep all specialized industry vocabulary in English (e.g., RAW Conversion, Vignette, Midtones, Highlights, Saturation, Curves, Layer Mask, etc.).

3. CRITICAL FORMATTING RULE - STRICT SRT STRUCTURE:
* DO NOT merge, group, or combine subtitle blocks.
* Maintain a strict 1-to-1 mapping. Every single index number and its exact timestamp from the source file MUST be preserved in the output.
* Maintain the strict timestamp format of HH:MM:SS.mmm (e.g., 00:01:02.860). Do not omit the hour '00:' and do not replace the period '.' with a colon ':' before the milliseconds.
* There must be exactly one blank line between each subtitle block.

4. Accuracy: Ensure the original meaning and step-by-step instructions are strictly preserved while adapting the tone.

Here is the specific glossary of terms you must keep in English:
${glossaryText}

Here is the SRT content to translate:
${srtContent}`;

  const modelsToTry = [
    config.gemini.model, // usually 'gemini-2.5-flash'
    'gemini-2.5-pro',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite'
  ];

  // Remove duplicates just in case config matches one of the fallbacks
  const uniqueModels = [...new Set(modelsToTry)];
  let lastError = null;

  for (const model of uniqueModels) {
    logger.info(`Sending SRT to Gemini API using model: ${model}...`);

    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          temperature: 0.2, // Low temperature for consistency
        }
      });

      let translatedSrt = response.text;

      // Clean up any markdown wrapping if the model ignores the instruction
      if (translatedSrt.startsWith('\`\`\`')) {
        translatedSrt = translatedSrt.replace(/^\`\`\`[a-z]*\n/, '').replace(/\n\`\`\`$/, '');
      }

      return translatedSrt.trim() + '\n';

    } catch (err) {
      logger.warn(`Model ${model} failed: ${err.message}`);
      lastError = err;
      // Try next model...
    }
  }

  // If all models fail
  throw new Error(`All Gemini fallback models failed. Last error: ${lastError?.message}`);
}

export default { translateWithGemini };
