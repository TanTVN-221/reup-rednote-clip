import { readFile, writeFile } from 'fs/promises';
import { translateCaption } from './src/translator/gemini.js';
import logger from './src/utils/logger.js';

async function run() {
  const statePath = './data/pipeline_state.json';
  const stateRaw = await readFile(statePath, 'utf-8');
  const state = JSON.parse(stateRaw);

  for (const [key, data] of Object.entries(state)) {
    logger.info(`Processing key: ${key}`);
    const videos = data.processedVideos || [];
    
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (v.uploadTiktokStatus === true) {
        // Skip already uploaded videos to save time and API quota
        logger.info(`Skipping already uploaded video: ${v.noteId}`);
        continue;
      }
      
      logger.info(`Updating caption for video: ${v.noteId}`);
      if (v.captionPath) {
        try {
          const captionRaw = await readFile(v.captionPath, 'utf-8');
          const captionData = JSON.parse(captionRaw);
          
          // Translate using the existing Gemini logic
          logger.info(`Translating ${v.noteId} via Gemini...`);
          const translatedData = await translateCaption({
            title: captionData.originalTitle || captionData.title || v.title || '',
            desc: captionData.originalCaption || captionData.desc || '',
            tags: captionData.originalTags || captionData.tags || [],
            publishTime: v.publishTime
          });
          
          // Update the entry in pipeline_state.json
          v.title = translatedData.title || v.title;
          v.desc = translatedData.desc || '';
          v.tags = translatedData.tags || [];
          
          // Update the caption file itself
          captionData.title = translatedData.title;
          captionData.desc = translatedData.desc;
          captionData.tags = translatedData.tags;
          
          await writeFile(v.captionPath, JSON.stringify(captionData, null, 2), 'utf-8');
          logger.success(`Updated ${v.noteId} successfully.`);
          
          // Wait a few seconds to avoid rate limiting
          await new Promise(r => setTimeout(r, 4000));
        } catch (err) {
          logger.error(`Failed to update ${v.noteId}: ${err.message}`);
        }
      }
    }
  }

  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
  logger.success('Finished updating pipeline_state.json and all caption files!');
}

run().catch(console.error);
