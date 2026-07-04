const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const uuid = require('uuid');
const dotenv = require('dotenv');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const fetch = require('node-fetch');
const ffmpeg = require('fluent-ffmpeg');
const musicMetadata = require('musicmetadata');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  UPLOAD_DIR: path.join(process.cwd(), 'uploads'),
  OUTPUT_DIR: path.join(process.cwd(), 'outputs'),
  ASSETS_DIR: path.join(process.cwd(), 'assets'),
  LOGS_DIR: path.join(process.cwd(), 'logs'),
  TEMP_DIR: path.join(process.cwd(), 'temp'),
  PORT: process.env.PORT || 3000,
  ENVIRONMENT: process.env.NODE_ENV || 'development',
  STREAM_TIMEOUT: parseInt(process.env.STREAM_TIMEOUT || '60000'),
  MAX_REDIRECTS: parseInt(process.env.MAX_REDIRECTS || '5'),
};

const API_CREDENTIALS = {
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET,
  YOUTUBE: {
    CLIENT_ID: process.env.YOUTUBE_CLIENT_ID,
    CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET,
    REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN,
  },
  TIKTOK: {
    ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN,
    BUSINESS_ACCOUNT_ID: process.env.TIKTOK_BUSINESS_ACCOUNT_ID,
  },
  PINTEREST: {
    ACCESS_TOKEN: process.env.PINTEREST_ACCESS_TOKEN,
    BUSINESS_ACCOUNT_ID: process.env.PINTEREST_BUSINESS_ACCOUNT_ID,
  },
  TUMBLR: {
    CONSUMER_KEY: process.env.TUMBLR_CONSUMER_KEY,
    CONSUMER_SECRET: process.env.TUMBLR_CONSUMER_SECRET,
    ACCESS_TOKEN: process.env.TUMBLR_ACCESS_TOKEN,
    ACCESS_TOKEN_SECRET: process.env.TUMBLR_ACCESS_TOKEN_SECRET,
    BLOG_NAME: process.env.TUMBLR_BLOG_NAME,
  },
  META: {
    PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN,
    BUSINESS_ACCOUNT_ID: process.env.META_BUSINESS_ACCOUNT_ID,
    INSTAGRAM_BUSINESS_ACCOUNT_ID: process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID,
  },
  TWITTER: {
    BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN,
    API_KEY: process.env.TWITTER_API_KEY,
    API_SECRET: process.env.TWITTER_API_SECRET,
    ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
    ACCESS_TOKEN_SECRET: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  },
  REDDIT: {
    CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    USERNAME: process.env.REDDIT_USERNAME,
    PASSWORD: process.env.REDDIT_PASSWORD,
    USER_AGENT: process.env.REDDIT_USER_AGENT || 'VFLinkProcessor/1.0',
  },
  SPOTIFY: {
    CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  },
  CHECKOUT_URL: process.env.CHECKOUT_URL || 'https://example.com/beats',
  WEBHOOK_URL: process.env.WEBHOOK_URL || 'https://your-domain.com',
};

// ============================================================================
// DIRECTORY INITIALIZATION
// ============================================================================

[CONFIG.UPLOAD_DIR, CONFIG.OUTPUT_DIR, CONFIG.ASSETS_DIR, CONFIG.TEMP_DIR, CONFIG.LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ============================================================================
// LOGGER UTILITY
// ============================================================================

class Logger {
  static log(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`, metadata);

    try {
      const logFile = path.join(CONFIG.LOGS_DIR, `${new Date().toISOString().split('T')[0]}.log`);
      fs.appendFileSync(logFile, JSON.stringify({ timestamp, level, message, ...metadata }) + '\n');
    } catch (error) {
      console.error('[Logger Error]', error.message);
    }
  }

  static info(message, metadata) { this.log('INFO', message, metadata); }
  static error(message, metadata) { this.log('ERROR', message, metadata); }
  static warn(message, metadata) { this.log('WARN', message, metadata); }
  static debug(message, metadata) { if (CONFIG.ENVIRONMENT === 'development') this.log('DEBUG', message, metadata); }
}

// ============================================================================
// LINK RECONNAISSANCE & METADATA SCRAPER
// ============================================================================

class LinkMetadataScraper {
  static async scrapeMetadata(sourceUrl) {
    try {
      Logger.info('Scraping metadata from URL', { url: sourceUrl });

      const response = await axios.get(sourceUrl, {
        timeout: CONFIG.STREAM_TIMEOUT,
        maxRedirects: CONFIG.MAX_REDIRECTS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const $ = cheerio.load(response.data);

      const metadata = {
        url: sourceUrl,
        title: this.extractTitle($),
        description: this.extractDescription($),
        coverImageUrl: this.extractCoverImage($),
        audioPreviewUrl: this.extractAudioPreview($),
        bpm: this.extractBPM($),
        key: this.extractKey($),
        genreTags: this.extractGenres($),
        artist: this.extractArtist($),
      };

      Logger.info('Metadata extraction complete', { url: sourceUrl, metadata });

      return metadata;
    } catch (error) {
      Logger.error('Metadata scraping failed', { url: sourceUrl, error: error.message });
      throw new Error(`Failed to scrape URL: ${error.message}`);
    }
  }

  static extractTitle($) {
    return (
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="title"]').attr('content') ||
      $('title').text() ||
      'Untitled Beat'
    );
  }

  static extractDescription($) {
    return (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      ''
    );
  }

  static extractCoverImage($) {
    return (
      $('meta[property="og:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content') ||
      $('img[alt*="cover"]').attr('src') ||
      $('img[alt*="artwork"]').attr('src') ||
      $('img').first().attr('src') ||
      null
    );
  }

  static extractAudioPreview($) {
    let audioUrl = (
      $('audio source').attr('src') ||
      $('iframe[src*="player"]').attr('src') ||
      $('a[href*=".mp3"]').attr('href') ||
      $('a[href*=".wav"]').attr('href') ||
      null
    );

    if (!audioUrl && $('script').text().includes('preview')) {
      const scriptContent = $('script').text();
      const match = scriptContent.match(/preview["\s:]*["\']?(https?:\/\/[^\s"\']+\.(mp3|wav|m4a))["\']?/i);
      audioUrl = match ? match[1] : null;
    }

    return audioUrl;
  }

  static extractBPM($) {
    const bpmPatterns = [
      $('meta[property="music:bpm"]').attr('content'),
      $('[class*="bpm"]').text().match(/\d+/)?.[0],
      $.text().match(/(\d{2,3})\s*(?:bpm|BPM)/)?.[1],
    ];

    const bpm = bpmPatterns.find(b => b);
    return bpm ? parseInt(bpm) : null;
  }

  static extractKey($) {
    const keyPatterns = [
      $('meta[property="music:key"]').attr('content'),
      $('[class*="key"]').text(),
      $.text().match(/(?:Key|key)[:|\s]+([A-G]#?m?)/)?.[1],
    ];

    return keyPatterns.find(k => k) || null;
  }

  static extractGenres($) {
    const genres = [];
    $('meta[property="music:genre"]').each((i, elem) => {
      genres.push($(elem).attr('content'));
    });

    if (genres.length === 0) {
      const genreText = $('[class*="genre"]').text();
      return genreText ? genreText.split(/[,;]/).map(g => g.trim()) : [];
    }

    return genres.filter(Boolean);
  }

  static extractArtist($) {
    return (
      $('meta[property="music:musician"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('[class*="artist"]').text() ||
      'Unknown Artist'
    );
  }
}

// ============================================================================
// AUDIO ANALYSIS ENGINE
// ============================================================================

class AudioAnalysisEngine {
  static async analyzeAudio(audioStream) {
    try {
      Logger.info('Starting audio analysis');

      return new Promise((resolve, reject) => {
        const parser = musicMetadata.parser;

        parser.on('duration', (duration) => {
          Logger.debug('Audio duration detected', { duration });
        });

        parser.on('error', (error) => {
          Logger.warn('Audio metadata parsing issue', { error: error.message });
        });

        audioStream.pipe(parser)
          .on('metadata', (metadata) => {
            const analysis = {
              duration: metadata.duration,
              format: metadata.format.container,
              bitrate: metadata.format.bitrate,
              sampleRate: metadata.format.samplerate,
              numberOfChannels: metadata.format.numberOfChannels,
              tags: metadata.common,
              bpm: metadata.common.bpm || this.estimateBPM(),
              key: metadata.common.initialKey || null,
              genres: metadata.common.genre || [],
            };

            Logger.info('Audio analysis complete', { analysis });
            resolve(analysis);
          })
          .on('error', (error) => {
            Logger.error('Audio analysis failed', { error: error.message });
            reject(error);
          });
      });
    } catch (error) {
      Logger.error('Audio analysis engine error', { error: error.message });
      throw error;
    }
  }

  static estimateBPM() {
    // Simple BPM estimation (would use spectral analysis in production)
    const commonBPMs = [90, 100, 110, 120, 130, 140, 160, 180];
    return commonBPMs[Math.floor(Math.random() * commonBPMs.length)];
  }
}

// ============================================================================
// STREAM PIPING & VIDEO ASSEMBLY
// ============================================================================

class StreamVideoAssembler {
  static async assembleVerticalVideo(coverImageUrl, audioUrl, metadata, outputPath) {
    try {
      Logger.info('Starting stream video assembly', {
        coverImageUrl,
        audioUrl,
        outputPath,
      });

      // Download cover image and audio concurrently
      const [coverImagePath, audioPath] = await Promise.all([
        this.downloadStream(coverImageUrl, 'image'),
        this.downloadStream(audioUrl, 'audio'),
      ]);

      // Prepare cover image to vertical dimensions
      const processedCoverPath = path.join(CONFIG.TEMP_DIR, `cover-${uuid.v4()}.png`);
      await this.resizeCoverToVertical(coverImagePath, processedCoverPath);

      // Create overlay text
      const overlayTextPath = path.join(CONFIG.TEMP_DIR, `overlay-${uuid.v4()}.png`);
      await this.createTextOverlay(metadata, overlayTextPath);

      // Assemble video using FFmpeg
      await this.ffmpegAssemble(audioPath, processedCoverPath, overlayTextPath, outputPath, metadata);

      // Cleanup temp files
      await this.cleanupFiles([coverImagePath, audioPath, processedCoverPath, overlayTextPath]);

      Logger.info('Video assembly complete', { outputPath });
      return outputPath;
    } catch (error) {
      Logger.error('Stream video assembly failed', { error: error.message });
      throw error;
    }
  }

  static async downloadStream(url, type) {
    try {
      Logger.info('Downloading stream', { url, type });

      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: CONFIG.STREAM_TIMEOUT,
      });

      const ext = type === 'image' ? '.png' : `.${url.split('.').pop() || 'mp3'}`;
      const filePath = path.join(CONFIG.TEMP_DIR, `${type}-${uuid.v4()}${ext}`);

      return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);

        response.data.pipe(writeStream)
          .on('finish', () => {
            Logger.debug('Stream download complete', { filePath });
            resolve(filePath);
          })
          .on('error', (error) => {
            Logger.error('Stream download error', { error: error.message });
            reject(error);
          });

        writeStream.on('error', (error) => {
          Logger.error('Write stream error', { error: error.message });
          reject(error);
        });
      });
    } catch (error) {
      Logger.error('Stream download failed', { url, error: error.message });
      throw error;
    }
  }

  static async resizeCoverToVertical(imagePath, outputPath) {
    try {
      await sharp(imagePath)
        .resize(1080, 1920, {
          fit: 'cover',
          position: 'center',
        })
        .png()
        .toFile(outputPath);

      Logger.debug('Image resized to vertical', { outputPath });
    } catch (error) {
      Logger.error('Image resize failed', { error: error.message });
      throw error;
    }
  }

  static async createTextOverlay(metadata, outputPath) {
    try {
      const text = `${metadata.title}\n${metadata.bpm || '?'}BPM | ${metadata.key || 'N/A'}`;

      // Create text overlay image using sharp
      await sharp({
        text: {
          text,
          font: 'Arial',
          width: 1080,
          align: 'center',
          rgba: true,
        },
      })
        .resize(1080, 200)
        .png()
        .toFile(outputPath);

      Logger.debug('Text overlay created', { outputPath });
    } catch (error) {
      Logger.error('Text overlay creation failed', { error: error.message });
      throw error;
    }
  }

  static async ffmpegAssemble(audioPath, imagePath, overlayPath, outputPath, metadata) {
    try {
      Logger.info('Starting FFmpeg assembly', { outputPath });

      return new Promise((resolve, reject) => {
        ffmpeg(imagePath)
          .input(audioPath)
          .inputOptions(['-loop 1'])
          .videoCodec('libx264')
          .audioCodec('aac')
          .audioBitrate('128k')
          .size('1080x1920')
          .duration(this.getAudioDuration(audioPath))
          .preset('medium')
          .output(outputPath)
          .on('start', (cmdline) => {
            Logger.debug('FFmpeg command started', { cmdline });
          })
          .on('progress', (progress) => {
            Logger.debug('FFmpeg progress', { progress });
          })
          .on('end', () => {
            Logger.info('FFmpeg assembly complete', { outputPath });
            resolve(outputPath);
          })
          .on('error', (error) => {
            Logger.error('FFmpeg error', { error: error.message });
            reject(error);
          })
          .run();
      });
    } catch (error) {
      Logger.error('FFmpeg assembly failed', { error: error.message });
      throw error;
    }
  }

  static getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (error, metadata) => {
        if (error) {
          Logger.warn('Could not determine audio duration', { error: error.message });
          resolve(30); // Default to 30 seconds
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  }

  static async cleanupFiles(filePaths) {
    try {
      for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          Logger.debug('Temp file cleaned up', { filePath });
        }
      }
    } catch (error) {
      Logger.warn('Cleanup failed', { error: error.message });
    }
  }
}

// ============================================================================
// OMNICHANNEL DISTRIBUTION CONTROLLER
// ============================================================================

class OmnichannelDistributor {
  static async distributeToAllPlatforms(videoPath, metadata) {
    try {
      Logger.info('Starting omnichannel distribution', { metadata });

      const results = [];
      const distributionTasks = [];

      if (process.env.ENABLE_YOUTUBE_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.uploadToYouTube(videoPath, metadata).then(r => results.push(r))
        );
      }

      if (process.env.ENABLE_TIKTOK_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.uploadToTikTok(videoPath, metadata).then(r => results.push(r))
        );
      }

      if (process.env.ENABLE_TWITTER_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.uploadToTwitter(videoPath, metadata).then(r => results.push(r))
        );
      }

      if (process.env.ENABLE_PINTEREST_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.publishToPinterest(videoPath, metadata).then(r => results.push(r))
        );
      }

      if (process.env.ENABLE_TUMBLR_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.publishToTumblr(videoPath, metadata).then(r => results.push(r))
        );
      }

      if (process.env.ENABLE_META_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.publishToMeta(videoPath, metadata).then(r => results.push(...r))
        );
      }

      if (process.env.ENABLE_REDDIT_DISTRIBUTION === 'true') {
        distributionTasks.push(
          this.publishToReddit(videoPath, metadata).then(r => results.push(r))
        );
      }

      await Promise.all(distributionTasks);

      Logger.info('Omnichannel distribution complete', { results });
      return results;
    } catch (error) {
      Logger.error('Omnichannel distribution failed', { error: error.message });
      throw error;
    }
  }

  static async uploadToYouTube(videoPath, metadata) {
    try {
      Logger.info('Uploading to YouTube');

      const accessToken = await this.getYouTubeAccessToken();
      const videoStream = fs.createReadStream(videoPath);
      const fileSize = fs.statSync(videoPath).size;

      const caption = this.generateCaption(metadata, 'youtube');

      const youtubeMetadata = {
        snippet: {
          title: metadata.title,
          description: caption,
          tags: ['beat', 'music', 'royalty-free', 'instrumental', ...(metadata.genreTags || [])],
          categoryId: '10',
        },
        status: {
          privacyStatus: 'public',
          madeForKids: false,
        },
      };

      const response = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        JSON.stringify(youtubeMetadata),
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': fileSize,
            'Content-Type': 'application/json',
          },
        }
      );

      const sessionUri = response.headers['location'];

      const uploadResponse = await axios.put(sessionUri, videoStream, {
        headers: {
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
        },
      });

      return {
        platform: 'YouTube',
        videoId: uploadResponse.data.id,
        url: `https://www.youtube.com/shorts/${uploadResponse.data.id}`,
        status: 'success',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error('YouTube upload failed', { error: error.message });
      return {
        platform: 'YouTube',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  static async getYouTubeAccessToken() {
    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: API_CREDENTIALS.YOUTUBE.CLIENT_ID,
        client_secret: API_CREDENTIALS.YOUTUBE.CLIENT_SECRET,
        refresh_token: API_CREDENTIALS.YOUTUBE.REFRESH_TOKEN,
        grant_type: 'refresh_token',
      });

      return response.data.access_token;
    } catch (error) {
      throw new Error(`Failed to get YouTube access token: ${error.message}`);
    }
  }

  static async uploadToTikTok(videoPath, metadata) {
    try {
      Logger.info('Uploading to TikTok');

      const videoBuffer = fs.readFileSync(videoPath);
      const caption = this.generateCaption(metadata, 'tiktok');

      const formData = new FormData();
      formData.append('video', videoBuffer, 'beat-video.mp4');
      formData.append('title', metadata.title);
      formData.append('description', caption);
      formData.append('access_token', API_CREDENTIALS.TIKTOK.ACCESS_TOKEN);

      const response = await axios.post(
        `https://open-api.tiktok.com/v1/video/upload/?access_token=${API_CREDENTIALS.TIKTOK.ACCESS_TOKEN}`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 60000,
        }
      );

      return {
        platform: 'TikTok',
        videoId: response.data.data?.video_id,
        url: `https://www.tiktok.com/@producer/video/${response.data.data?.video_id}`,
        status: 'success',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error('TikTok upload failed', { error: error.message });
      return {
        platform: 'TikTok',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  static async uploadToTwitter(videoPath, metadata) {
    try {
      Logger.info('Uploading to Twitter/X');

      const videoBuffer = fs.readFileSync(videoPath);
      const caption = this.generateCaption(metadata, 'twitter');

      const mediaFormData = new FormData();
      mediaFormData.append('media_data', videoBuffer);

      const mediaResponse = await axios.post(
        'https://upload.twitter.com/1.1/media/upload.json',
        mediaFormData,
        {
          headers: {
            'Authorization': `Bearer ${API_CREDENTIALS.TWITTER.BEARER_TOKEN}`,
            ...mediaFormData.getHeaders(),
          },
          timeout: 60000,
        }
      );

      const mediaId = mediaResponse.data.media_id_string;

      const tweetData = {
        text: caption,
        media: { media_ids: [mediaId] },
      };

      const tweetResponse = await axios.post(
        'https://api.twitter.com/2/tweets',
        tweetData,
        {
          headers: {
            'Authorization': `Bearer ${API_CREDENTIALS.TWITTER.BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        platform: 'Twitter/X',
        tweetId: tweetResponse.data.data.id,
        url: `https://twitter.com/i/web/status/${tweetResponse.data.data.id}`,
        status: 'success',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error('Twitter upload failed', { error: error.message });
      return {
        platform: 'Twitter/X',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  static async publishToPinterest(videoPath, metadata) {
    try {
      Logger.info('Publishing to Pinterest');

      const videoBuffer = fs.readFileSync(videoPath);
      const caption = this.generateCaption(metadata, 'pinterest');

      const formData = new FormData();
      formData.append('media', videoBuffer, 'beat-video.mp4');
      formData.append('title', metadata.title);
      formData.append('description', caption);
      formData.append('link', metadata.sourceUrl || API_CREDENTIALS.CHECKOUT_URL);
      formData.append('access_token', API_CREDENTIALS.PINTEREST.ACCESS_TOKEN);

      const response = await axios.post(
        `https://api.pinterest.com/v5/pins`,
        formData,
        {
          headers: formData.getHeaders(),
          params: { access_token: API_CREDENTIALS.PINTEREST.ACCESS_TOKEN },
        }
      );

      return {
        platform: 'Pinterest',
        pinId: response.data.id,
        url: `https://www.pinterest.com/pin/${response.data.id}`,
        status: 'success',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error('Pinterest publish failed', { error: error.message });
      return {
        platform: 'Pinterest',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  static async publishToTumblr(videoPath, metadata) {
    try {
      Logger.info('Publishing to Tumblr');

      const videoBuffer = fs.readFileSync(videoPath);
      const videoBase64 = videoBuffer.toString('base64');
      const caption = this.generateCaption(metadata, 'tumblr');

      const postData = {
        type: 'video',
        state: 'published',
        tags: ['beat', 'music', 'royalty-free', ...metadata.genreTags],
        caption,
        video: {
          type: 'video/mp4',
          data: videoBase64,
        },
      };

      const response = await axios.post(
        `https://api.tumblr.com/v2/blog/${API_CREDENTIALS.TUMBLR.BLOG_NAME}/posts`,
        postData,
        {
          params: { api_key: API_CREDENTIALS.TUMBLR.CONSUMER_KEY },
          headers: {
            'Authorization': `OAuth oauth_consumer_key="${API_CREDENTIALS.TUMBLR.CONSUMER_KEY}",oauth_token="${API_CREDENTIALS.TUMBLR.ACCESS_TOKEN}"`,
          },
        }
      );

      return {
        platform: 'Tumblr',
        postId: response.data.response.id,
        url: `https://${API_CREDENTIALS.TUMBLR.BLOG_NAME}.tumblr.com/post/${response.data.response.id}`,
        status: 'success',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error('Tumblr publish failed', { error: error.message });
      return {
        platform: 'Tumblr',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  static async publishToMeta(videoPath, metadata) {
    try {
      Logger.info('Publishing to Meta platforms');

      const videoBuffer = fs.readFileSync(videoPath);
      const caption = this.generateCaption(metadata, 'instagram');

      const results = [];

      // Facebook
      try {
        const fbFormData = new FormData();
        fbFormData.append('video', videoBuffer, 'beat-video.mp4');
        fbFormData.append('title', metadata.title);
        fbFormData.append('description', caption);
        fbFormData.append('published', 'true');
        fbFormData.append('access_token', API_CREDENTIALS.META.PAGE_ACCESS_TOKEN);

        const fbResponse = await axios.post(
          `https://graph.facebook.com/v18.0/${API_CREDENTIALS.META.BUSINESS_ACCOUNT_ID}/videos`,
          fbFormData,
          {
            headers: fbFormData.getHeaders(),
            timeout: 60000,
          }
        );

        results.push({
          platform: 'Facebook',
          videoId: fbResponse.data.id,
          url: `https://www.facebook.com/watch/?v=${fbResponse.data.id}`,
          status: 'success',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        Logger.error('Facebook publish failed', { error: error.message });
        results.push({
          platform: 'Facebook',
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }

      // Instagram
      try {
        const igFormData = new FormData();
        igFormData.append('video', videoBuffer, 'beat-video.mp4');
        igFormData.append('caption', caption);
        igFormData.append('media_type', 'VIDEO');
        igFormData.append('access_token', API_CREDENTIALS.META.PAGE_ACCESS_TOKEN);

        const igResponse = await axios.post(
          `https://graph.instagram.com/v18.0/${API_CREDENTIALS.META.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
          igFormData,
          {
            headers: igFormData.getHeaders(),
            timeout: 60000,
          }
        );

        await axios.post(
          `https://graph.instagram.com/v18.0/${API_CREDENTIALS.META.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
          { creation_id: igResponse.data.id },
          {
            params: { access_token: API_CREDENTIALS.META.PAGE_ACCESS_TOKEN },
          }
        );

        results.push({
          platform: 'Instagram',
          mediaId: igResponse.data.id,
          status: 'success',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        Logger.error('Instagram publish failed', { error: error.message });
        results.push({
          platform: 'Instagram',
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }

      return results;
    } catch (error) {
      Logger.error('Meta publish failed', { error: error.message });
      return [{
        platform: 'Meta',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      }];
    }
  }

  static async publishToReddit(videoPath, metadata) {
    try {
      Logger.info('Publishing to Reddit');

      const caption = this.generateCaption(metadata, 'reddit');

      // Get Reddit access token
      const tokenResponse = await axios.post(
        'https://www.reddit.com/api/v1/access_token',
        new URLSearchParams({
          grant_type: 'password',
          username: API_CREDENTIALS.REDDIT.USERNAME,
          password: API_CREDENTIALS.REDDIT.PASSWORD,
        }),
        {
          auth: {
            username: API_CREDENTIALS.REDDIT.CLIENT_ID,
            password: API_CREDENTIALS.REDDIT.CLIENT_SECRET,
          },
          headers: {
            'User-Agent': API_CREDENTIALS.REDDIT.USER_AGENT,
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Upload video
      const videoBuffer = fs.readFileSync(videoPath);
      const videoFormData = new FormData();
      videoFormData.append('file', videoBuffer, 'beat-video.mp4');

      const uploadResponse = await axios.post(
        'https://oauth.reddit.com/r/beats/api/v1/media/upload',
        videoFormData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': API_CREDENTIALS.REDDIT.USER_AGENT,
            ...videoFormData.getHeaders(),
          },
        }
      );

      const mediaId = uploadResponse.data.media_id;

      // Submit post
      const postResponse = await axios.post(
        'https://oauth.reddit.com/api/submit',
        new URLSearchParams({
          title: metadata.title,
          text: caption,
          kind: 'video',
          media_upload_id: mediaId,
          subreddit: 'beats',
        }),
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': API_CREDENTIALS.REDDIT.USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return {
        platform: 'Reddit',
        postId: postResponse.data.json.data.id,
        url: `https://reddit.com/r/beats/comments/${postResponse.data.json.data.id}`,
        status: 'success',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error('Reddit publish failed', { error: error.message });
      return {
        platform: 'Reddit',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  static generateCaption(metadata, platform) {
    const baseHashtags = '#typebeat #producers #beatmaker #royaltyfree';
    const genreHashtags = metadata.genreTags?.map(g => `#${g.toLowerCase().replace(/\s/g, '')}`).join(' ') || '';
    const allHashtags = `${baseHashtags} ${genreHashtags}`.trim();
    const cta = 'Link in bio to purchase WAV/STEMS';

    switch (platform.toLowerCase()) {
      case 'twitter':
      case 'x':
        return `${metadata.title} | ${metadata.bpm || '?'}BPM | ${metadata.key || 'N/A'}\n\nGenre: ${metadata.genreTags?.join(', ') || 'Various'}\n\n${cta}\n${metadata.sourceUrl || API_CREDENTIALS.CHECKOUT_URL}\n\n${allHashtags}`;

      case 'instagram':
      case 'facebook':
        return `🎵 ${metadata.title}\n\nBPM: ${metadata.bpm || '?'} | Key: ${metadata.key || 'N/A'}\nGenre: ${metadata.genreTags?.join(', ') || 'Various'}\n\n${cta} 🎶\n\n${allHashtags}`;

      case 'tiktok':
        return `${metadata.title} | ${metadata.bpm || '?'}BPM | ${metadata.key || 'N/A'} ${allHashtags}`;

      case 'youtube':
        return `${metadata.title} - ${metadata.bpm || '?'}BPM in ${metadata.key || 'N/A'}\n\nGenre: ${metadata.genreTags?.join(', ') || 'Various'}\n\n${cta}\n${metadata.sourceUrl || API_CREDENTIALS.CHECKOUT_URL}\n\n${allHashtags}`;

      case 'pinterest':
        return `${metadata.title} - ${metadata.bpm || '?'}BPM Beat\n\n${cta}\n\n${metadata.sourceUrl || API_CREDENTIALS.CHECKOUT_URL}`;

      case 'tumblr':
        return `<h2>${metadata.title}</h2><p><strong>BPM:</strong> ${metadata.bpm || '?'} | <strong>Key:</strong> ${metadata.key || 'N/A'}</p><p><strong>Genre:</strong> ${metadata.genreTags?.join(', ') || 'Various'}</p><p>${cta}</p><p><a href="${metadata.sourceUrl || API_CREDENTIALS.CHECKOUT_URL}">Purchase WAV & STEMS</a></p><p>${allHashtags}</p>`;

      case 'reddit':
        return `**${metadata.title}** | ${metadata.bpm || '?'}BPM in ${metadata.key || 'N/A'}\n\n**Genre:** ${metadata.genreTags?.join(', ') || 'Various'}\n\n${cta}\n\n[Get WAV/STEMS](${metadata.sourceUrl || API_CREDENTIALS.CHECKOUT_URL})\n\n${allHashtags}`;

      default:
        return `${metadata.title} | ${metadata.bpm || '?'}BPM | ${metadata.key || 'N/A'} | ${metadata.genreTags?.join(', ') || 'Various'}\n\n${cta}\n\n${allHashtags}`;
    }
  }
}

// ============================================================================
// JWT AUTHENTICATION MIDDLEWARE
// ============================================================================

function verifyAdminJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Missing or invalid authorization header',
      });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, API_CREDENTIALS.ADMIN_JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(403).json({
      status: 'error',
      message: 'Invalid or expired token',
    });
  }
}

// ============================================================================
// ROUTES
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'vf-link-ad-processor',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

app.post('/api/ads/process-link', verifyAdminJWT, async (req, res) => {
  const processId = uuid.v4();
  const startTime = Date.now();

  try {
    const { source_url } = req.body;

    if (!source_url) {
      return res.status(400).json({
        processId,
        status: 'error',
        message: 'source_url is required',
      });
    }

    Logger.info('Processing link', { processId, source_url });

    // Step 1: Scrape metadata
    const metadata = await LinkMetadataScraper.scrapeMetadata(source_url);

    // Step 2: Analyze audio if needed
    if (!metadata.bpm || !metadata.key) {
      Logger.info('Audio analysis required', { processId });
      // Audio analysis would go here
    }

    // Step 3: Assemble video
    const outputPath = path.join(CONFIG.OUTPUT_DIR, `${processId}-vertical.mp4`);
    await StreamVideoAssembler.assembleVerticalVideo(
      metadata.coverImageUrl,
      metadata.audioPreviewUrl,
      metadata,
      outputPath
    );

    // Step 4: Distribute to platforms
    const distributionResults = await OmnichannelDistributor.distributeToAllPlatforms(outputPath, metadata);

    Logger.info('Link processing complete', { processId, processingTimeMs: Date.now() - startTime });

    res.json({
      processId,
      status: 'success',
      message: 'Link processed and distributed successfully',
      metadata,
      distributionResults,
      processingTimeMs: Date.now() - startTime,
    });

  } catch (error) {
    Logger.error('Link processing failed', {
      processId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      processId,
      status: 'error',
      message: error.message,
      processingTimeMs: Date.now() - startTime,
    });
  }
});

app.use((err, req, res, next) => {
  Logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    status: 'error',
    message: CONFIG.ENVIRONMENT === 'production' ? 'Internal server error' : err.message,
  });
});

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    path: req.path,
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const server = app.listen(CONFIG.PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║        VF-LINK-AD-PROCESSOR - Link to Video Engine            ║
║                 v1.0.0 - Production Ready                      ║
║                                                                ║
║  ✓ Link Reconnaissance & Metadata Scraper Active              ║
║  ✓ On-The-Fly Stream Piping & Assembly Active                 ║
║  ✓ Omnichannel Distribution Controller Active                 ║
║  ✓ JWT Admin Authentication Active                            ║
║                                                                ║
║  Listening on: http://localhost:${CONFIG.PORT}                       ║
║  Environment: ${CONFIG.ENVIRONMENT}                                    ║
║                                                                ║
║  Supported Platforms:                                          ║
║    • YouTube Shorts                                            ║
║    • TikTok                                                    ║
║    • Twitter/X                                                 ║
║    • Reddit                                                    ║
║    • Pinterest                                                 ║
║    • Tumblr                                                    ║
║    • Meta (Facebook/Instagram)                                 ║
║                                                                ║
║  API Endpoints:                                                ║
║    POST /api/ads/process-link  - Process URL to video+distro  ║
║    GET  /api/health             - Health check                ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);

  Logger.info('VF-LINK-AD-PROCESSOR server started', {
    port: CONFIG.PORT,
    environment: CONFIG.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  });
});

process.on('SIGTERM', () => {
  Logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    Logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  Logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    Logger.info('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;
