import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const config = {
  // Paths
  rootDir: ROOT_DIR,
  dataDir: join(ROOT_DIR, 'data'),
  downloadsDir: join(ROOT_DIR, 'data', 'downloads'),
  transcriptsDir: join(ROOT_DIR, 'data', 'transcripts'),
  translatedDir: join(ROOT_DIR, 'data', 'translated'),
  outputDir: process.env.OUTPUT_DIR ? join(ROOT_DIR, process.env.OUTPUT_DIR.replace(/^.\//, '')) : join(ROOT_DIR, 'data', 'output'),
  tempDir: join(ROOT_DIR, 'data', 'temp'),
  glossaryPath: join(__dirname, 'glossary.json'),

  // Video processing
  video: {
    cutIntroSeconds: parseFloat(process.env.CUT_INTRO_SECONDS) || 0,
    cutOutroSeconds: parseFloat(process.env.CUT_OUTRO_SECONDS) || 3.0,
  },

  // RedNote API Configuration
  rednote: {
    cookie: process.env.REDNOTE_COOKIE || '',
  },



  // RedNote crawler settings
  rednote_settings: {
    scrollDelay: 2000,       // ms between scroll actions when crawling
    requestDelay: 1000,      // ms between requests (rate limiting)
  },

  // Downloader
  downloader: {
    preferYtdlp: true,       // try yt-dlp first, then Playwright
    maxRetries: 3,
    timeout: 60000,          // 60s download timeout
  },

  // Whisper (Speech-to-Text)
  whisper: {
    modelName: process.env.WHISPER_MODEL || 'medium',
    language: 'zh',          // Chinese
  },

  // OCR
  ocr: {
    language: 'chi_sim',     // Tesseract Chinese Simplified
    frameInterval: 2,        // extract frame every N seconds
    minConfidence: 60,       // minimum OCR confidence (0-100)
  },

  // Translation
  translation: {
    sourceLanguage: 'zh-CN',
    targetLanguage: 'vi',
    requestDelay: 500,       // ms between translation requests
    maxRetries: 3,
  },

  // TTS (Text-to-Speech)
  tts: {
    provider: process.env.TTS_PROVIDER || 'auto', // 'auto', 'edge', or 'google'
    voice: process.env.TTS_VOICE || 'vi-VN-HoaiMyNeural',
    rate: process.env.TTS_RATE || '+0%',
    originalAudioVolume: parseFloat(process.env.ORIGINAL_AUDIO_VOLUME) || 0.2,
  },

  // Gemini API
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  // Subtitle styling
  subtitle: {
    fontSize: parseInt(process.env.SUBTITLE_FONT_SIZE) || 16,
    fontColor: process.env.SUBTITLE_FONT_COLOR || 'white',
    outlineColor: process.env.SUBTITLE_OUTLINE_COLOR || 'black',
    position: process.env.SUBTITLE_POSITION || 'bottom',
    fontName: 'Arial',
    outlineWidth: 0.5,
    marginV: 15,             // vertical margin from bottom
  },

  // Zernio Upload (Phase 2)
  zernio: {
    apiKey: process.env.ZERNIO_API_KEY || '',
    tiktokAccountId: process.env.ZERNIO_TIKTOK_ACCOUNT_ID || '',
  },
};

export default config;
