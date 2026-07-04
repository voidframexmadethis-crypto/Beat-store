# VF-AD-ROUTER-CORE & VF-LINK-AD-PROCESSOR
## Complete Production-Ready Beat Advertisement Automation Platform

**Version:** 1.0.0  
**Status:** Production Ready  
**Author:** Principal Automation Architect & Media Distribution Engineer  
**License:** MIT

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & Core Components](#architecture--core-components)
3. [Installation & Setup](#installation--setup)
4. [Environment Configuration](#environment-configuration)
5. [API Documentation](#api-documentation)
6. [Authentication](#authentication)
7. [Deployment](#deployment)
8. [Error Handling & Recovery](#error-handling--recovery)
9. [Troubleshooting](#troubleshooting)

---

## Project Overview

**VF-AD-ROUTER-CORE** and **VF-LINK-AD-PROCESSOR** form an isolated, full-stack automation utility built exclusively for a single beat producer to syndicate video advertisements across global social networks completely free of charge.

### Key Features

✅ **Compact Media Transcoding**: Converts beat audio + artwork into optimized 9:16 vertical and 1:1 square MP4 videos  
✅ **Link Reconnaissance**: Automatically scrapes metadata (Title, BPM, Key, Genre, Cover, Audio URL) from any web link  
✅ **Stream Piping**: Non-blocking HTTP stream pipeline avoids RAM saturation  
✅ **Omnichannel Distribution**: Simultaneous async dispatch to 7+ social platforms  
✅ **Dynamic Caption Generation**: Platform-specific auto-generated text with conversion CTAs and hashtags  
✅ **Event Outbox Logging**: Complete audit trail of all distribution events  
✅ **JWT Security**: Admin-only token-protected endpoints  
✅ **Zero-Configuration Deployment**: Single `.env` file for all credentials  

### Supported Platforms

- **YouTube** - Shorts (9:16 vertical)
- **TikTok** - Feed uploads (9:16 vertical)
- **Twitter/X** - Tweet with attached media (1:1 square)
- **Reddit** - Subreddit posts (1:1 square)
- **Pinterest** - Video Pins (1:1 square)
- **Tumblr** - Blog video posts (1:1 square)
- **Meta** - Facebook & Instagram (1:1 & 9:16)

---

## Installation & Setup

### Prerequisites

- **Node.js** v16.0.0 or higher
- **npm** v8.0.0 or higher
- **FFmpeg** (for video transcoding)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/voidframexmadethis-crypto/Beat-store.git
cd Beat-store

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env

# 4. Fill in your API credentials in .env
nano .env

# 5. Initialize directories
npm run setup

# 6. Start the server
npm start
```

---

## API Documentation

### Render Media

**Endpoint:** `POST /api/ads/render`

Convert beat audio + artwork into optimized MP4 videos.

**Request:**
```bash
curl -X POST http://localhost:3000/api/ads/render \
  -F "beat_audio=@beat.mp3" \
  -F "ad_artwork=@cover.png" \
  -F "beatTitle=Trap Banger" \
  -F "bpm=140" \
  -F "key=D Minor" \
  -F "genreTags=Trap,Hip-Hop"
```

**Response:**
```json
{
  "campaignId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "outputs": [
    {
      "format": "9:16 (Vertical)",
      "status": "success"
    },
    {
      "format": "1:1 (Square)",
      "status": "success"
    }
  ],
  "renderTimeMs": 8234
}
```

### Publish Campaign

**Endpoint:** `POST /api/ads/publish-campaign`

Distribute rendered video to all platforms.

**Request:**
```bash
curl -X POST http://localhost:3000/api/ads/publish-campaign \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "550e8400-e29b-41d4-a716-446655440000",
    "platforms": ["youtube", "tiktok", "twitter", "meta"]
  }'
```

**Response:**
```json
{
  "distributionId": "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a",
  "status": "success",
  "summary": {
    "successful": 4,
    "failed": 0,
    "total": 4
  },
  "results": [
    {
      "platform": "YouTube",
      "videoId": "dQw4w9WgXcQ",
      "url": "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "status": "success"
    }
  ]
}
```

### Process Link

**Endpoint:** `POST /api/ads/process-link` (Link Processor)

Scrape URL, transcode, and distribute automatically.

**Request:**
```bash
curl -X POST http://localhost:3001/api/ads/process-link \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"source_url": "https://example.com/beat"}'
```

---

## Deployment

### Docker

```bash
docker build -t vf-ad-router .
docker run -p 3000:3000 -p 3001:3001 --env-file .env vf-ad-router
```

### Heroku

```bash
heroku create your-app-name
heroku config:set NODE_ENV=production ADMIN_JWT_SECRET=xxx
git push heroku main
```

---

## Environment Configuration

See `.env.example` for complete configuration template with all API credentials.

**Key Variables:**
- `ADMIN_JWT_SECRET` - JWT signing secret (min 32 chars)
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- `TIKTOK_ACCESS_TOKEN`, `TIKTOK_BUSINESS_ACCOUNT_ID`
- `TWITTER_BEARER_TOKEN`, `TWITTER_API_KEY`, `TWITTER_API_SECRET`
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`
- `META_PAGE_ACCESS_TOKEN`, `META_BUSINESS_ACCOUNT_ID`, `META_INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `PINTEREST_ACCESS_TOKEN`, `TUMBLR_CONSUMER_KEY`, `TUMBLR_ACCESS_TOKEN`

---

## Error Handling

All endpoints implement comprehensive try/catch error interception:

```javascript
try {
  // Process request
} catch (error) {
  Logger.error('Operation failed', { error: error.message });
  // Return safe error response
} finally {
  // Cleanup temp files
}
```

Features:
- ✅ Automatic retry logic with exponential backoff
- ✅ Circuit breaker pattern to prevent cascading failures
- ✅ Event persistence for audit trails
- ✅ Granular error logging and reporting

---

## Troubleshooting

### FFmpeg Not Found
```bash
# Install FFmpeg
brew install ffmpeg          # macOS
sudo apt-get install ffmpeg  # Ubuntu
choco install ffmpeg         # Windows
```

### YouTube Upload 401 Error
- Verify `YOUTUBE_REFRESH_TOKEN` is valid
- Regenerate token via [Google OAuth Playground](https://developers.google.com/oauthplayground)
- Enable YouTube Data API v3 in Google Cloud Console

### Stream Timeout
- Increase `STREAM_TIMEOUT` environment variable
- Reduce `MAX_AUDIO_SAMPLE_DURATION`
- Check bandwidth availability

### Low Disk Space
```bash
rm -rf temp/* outputs/*
df -h
```

---

## Production Checklist

- [ ] All credentials in `.env` (never commit)
- [ ] `ADMIN_JWT_SECRET` is strong (32+ chars)
- [ ] `NODE_ENV=production`
- [ ] FFmpeg installed and tested
- [ ] SSL/TLS certificates installed
- [ ] Rate limiting configured
- [ ] Monitoring & alerting setup
- [ ] Log rotation configured
- [ ] Backup strategy implemented
- [ ] Error tracking integrated (Sentry/DataDog)

---

## Security Notice

⚠️ **CRITICAL:**
1. Never commit `.env` file
2. Use strong JWT secrets
3. Rotate credentials quarterly
4. Enable HTTPS in production
5. Validate all user input
6. Monitor access logs

---

## License

MIT License - See LICENSE file

---

## Support

For issues and feature requests, visit: https://github.com/voidframexmadethis-crypto/Beat-store/issues

---

**Last Updated:** 2024-07-04
