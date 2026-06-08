# 🎬 RedNote Clip Downloader & Translator

An automated, end-to-end pipeline designed to download videos from RedNote (Xiaohongshu), transcribe the audio, translate Chinese to Vietnamese, generate a synchronized Vietnamese voiceover, and burn highly legible subtitles directly into the video—making it instantly ready for re-uploading to TikTok or Reels.

## ✨ Features

- **Automated Downloading**: Fetch single videos or crawl entire RedNote channels (powered natively by Playwright Chromium).
- **Local Video Processing**: Easily process bulk `.mp4` files from a local directory.
- **Smart Transcription**: Uses local Whisper AI models to accurately transcribe Chinese audio.
- **OCR Text Extraction**: Scans videos for hardcoded Chinese text, translates it, and overlays a solid background box to cover the original text.
- **AI Translation with Glossary**: Uses Google Gemini AI (with a multi-model fallback system) to translate Chinese to Vietnamese. Supports a custom Glossary to enforce specific domain vocabulary!
- **Triple-Fallback TTS Engine**: Generates natural Vietnamese voiceovers using Microsoft Edge TTS, with automatic fallbacks to Python `edge-tts` and `google-tts-api` to prevent rate-limit crashes.
- **Auto-Trimming**: Automatically trims intros and RedNote watermarked outros without misaligning the audio/subtitles.
- **Subtitle Burn-in**: Highly stylized, aesthetic subtitle generation using FFmpeg ASS filters.

## 🛠 Prerequisites

Before running this project, ensure you have the following installed on your system:
1. **Node.js** (v18 or higher)
2. **FFmpeg** (Must be installed and available in your system's PATH)
   - Mac: `brew install ffmpeg`
   - Windows: `winget install ffmpeg`
3. **Python 3.x** (Required for Whisper and `edge-tts` CLI fallbacks)

## 📦 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/reup-rednote-clip.git
   cd reup-rednote-clip
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Install Python dependencies (for fallbacks):**
   ```bash
   pip install edge-tts
   ```

4. **Environment Setup:**
   Copy the example environment file and fill in your keys.
   ```bash
   cp .env.example .env
   ```
   **Required Keys in `.env`:**
   - `GEMINI_API_KEY`: Your Google Gemini API Key for translation.

## 🚀 Usage

The pipeline is operated entirely via the CLI. 

### 1. Process a Local Directory
Process a folder of pre-downloaded `.mp4` files.
```bash
node src/cli.js process-local ./videos_test
```

### 2. Process a Single URL
Download and process a specific RedNote video.
```bash
node src/cli.js process-video "https://www.xiaohongshu.com/explore/..."
```

### 3. Process an Entire Channel
Crawl and process all videos from a RedNote creator's channel.
```bash
node src/cli.js process-channel "https://www.xiaohongshu.com/user/profile/..."
```

### ⚙️ Helpful CLI Flags
You can append these flags to any of the processing commands above to customize the pipeline:
- `--skip-ocr`: Skips optical character recognition (makes processing significantly faster if the video has no hardcoded on-screen text).
- `--skip-tts`: Skips Vietnamese voiceover generation (keeps original audio).
- `--clean-all`: Completely wipes the temporary, transcript, and translation cache folders after the pipeline finishes.
- `--resume`: (Channel only) Resumes processing a channel if it was previously interrupted.
- `--limit <n>`: (Channel only) Limits the maximum number of videos to process.

*Example:*
```bash
node src/cli.js process-local ./videos_test --skip-ocr --clean-all
```

## 📚 Custom Dictionary (Glossary)

You can force the Gemini AI translator to translate specific Chinese terms into specific Vietnamese terms by adding them to your local glossary.

**Add a new term:**
```bash
node src/cli.js glossary-add "Capture One" "Capture One" "Phần mềm chỉnh sửa ảnh"
```

**List all terms:**
```bash
node src/cli.js glossary-list
```

## ✂️ Auto-Trimming
If the videos you are processing contain baked-in intros or RedNote watermark outros, you can automatically trim them. 
Open your `.env` file and adjust:
```env
CUT_INTRO_SECONDS=0.5
CUT_OUTRO_SECONDS=3.0
```
*Note: Trimming dynamically shifts all AI subtitles and voiceovers backwards to perfectly match the new timeline!*

## 📁 Folder Structure
- `data/downloads/`: Raw downloaded videos.
- `data/transcripts/`: Extracted Chinese SRTs from Whisper.
- `data/translated/`: Gemini translated Vietnamese SRTs.
- `data/output/`: Final rendered videos ready for TikTok.
- `data/temp/`: Ephemeral processing files.
