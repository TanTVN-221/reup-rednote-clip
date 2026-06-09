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
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3.1-pro-preview'
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

/**
 * Translate and optimize video metadata (title, desc, tags) from Chinese to Vietnamese.
 * Outputs a strict JSON object ready for TikTok upload via Zernio.
 *
 * @param {object} captionData - The raw caption data extracted from the video
 * @returns {Promise<object>} The translated caption JSON
 */
export async function translateCaption(captionData) {
  const ai = getClient();
  const inputJson = JSON.stringify({
    title: captionData.originalTitle || captionData.title || '',
    desc: captionData.originalCaption || captionData.desc || '',
    tags: captionData.originalTags || captionData.tags || [],
    publishTime: captionData.publishTime
  }, null, 2);

  const prompt = `Act as an Expert Photographer, Retoucher, and Bilingual Translator (Chinese to Vietnamese). I will provide you with a JSON object containing the metadata (title, description, tags, publishTime) of a RedNote tutorial video about photography and photo editing. 

Your task is to translate the title, description, and tags into Vietnamese and output a SINGLE valid JSON object.

Follow these strict guidelines:
1. **Title Length & Style:** Translate and optimize the \`title\` to be VERY short, punchy, and easy to understand at a glance (maximum 10 words). Focus on the core value of the video.
2. **Target Audience (Beginners):** Translate technical editing terms (e.g., 磨皮, 转档, 光影, 调色) into natural, easy-to-understand Vietnamese terminology used in software like Photoshop/Capture One. If a concept is complex, phrase it in a way that is intuitive (e.g., use "Curve RGB" instead of translating literally to "Đường cong RGB").
3. **Tone:** Keep the tone professional, educational, and engaging.
4. **Description Formatting:** 
   - You MUST preserve all newline characters (\`\\n\`) exactly as they appear in the source JSON to ensure correct line breaks when sent via APIs.
   - The translated description MUST follow this exact format:
   [Translated content of the original description]
   --------------------------------
   Đây là clip reup và dịch tiếng việt từ kênh wenlinxiutu. Nếu bạn thấy thông tin này hữu ích, hãy vào kênh chính thức wenlinxiutu ở Rednote để ủng hộ tác giả nhé. Cảm ơn mọi người đã ủng hộ ❤️.
5. **Tags:** Translate the Chinese tags into popular, relevant Vietnamese hashtags without the "#" symbol. Keep some international terms if they are commonly used in VN (like "retouch", "color_grading").
6. **Output Format:** Return ONLY a valid JSON structure with the keys: \`title\`, \`desc\`, \`tags\`, and \`publishTime\`. Do not output any Markdown code block delimiters or extra conversational text outside the JSON.

Here is the JSON to transform:
${inputJson}`;

  const modelsToTry = [
    config.gemini.model, // usually 'gemini-2.5-flash'
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite'
  ];

  const uniqueModels = [...new Set(modelsToTry)];
  let lastError = null;

  for (const model of uniqueModels) {
    logger.info(`Translating caption using model: ${model}...`);

    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          temperature: 0.3,
          responseMimeType: 'application/json' // Enforce JSON output
        }
      });

      let responseText = response.text;

      // Safety cleanup if model still returns markdown blocks
      if (responseText.startsWith('\`\`\`')) {
        responseText = responseText.replace(/^\`\`\`(?:json)?\n/, '').replace(/\n\`\`\`$/, '');
      }

      return JSON.parse(responseText);

    } catch (err) {
      logger.warn(`Caption translation failed with ${model}: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`All Gemini models failed for caption translation. Last error: ${lastError?.message}`);
}

export default { translateWithGemini, translateCaption };
