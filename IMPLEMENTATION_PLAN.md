# Implementation Plan: Article-to-Podcast Chrome Extension

## Project Status: MVP Complete (v0.0.1)
Core functionality implemented. Ready for manual testing.

**Goal:** Fully functional Chrome extension that converts any web article to natural-sounding audio with one click, featuring a floating player, MP3 download, and usage-limited free tier (10 articles/month).

**MVP Scope (v1):**
- Article extraction via Readability.js
- OpenAI TTS API integration with chunking/stitching
- Extension popup with convert button
- Floating audio player with playback controls
- MP3 download with metadata
- Free tier: 10 articles/month limit
- NO backend, NO payment integration, NO podcast feed (deferred to v2)

---

## Completed Features

### Priority 1: Core Infrastructure ✅
- [x] Created `src/manifest.json` with Manifest V3 structure
  - Permissions: `activeTab`, `storage`, `downloads`
  - Host permissions: `https://api.openai.com/*`
  - Background service worker declared
  - Content script declared
  - Popup declared
- [x] Created extension icons (placeholder solid color PNGs)
- [x] Set up folder structure per spec

### Priority 2: Article Extraction ✅
- [x] Added Mozilla Readability.js to `src/lib/Readability.js`
- [x] Implemented content script (`src/content.js`)
  - Runs Readability on current page DOM
  - Implements `ExtractedArticle` interface
  - Fallback extraction if Readability fails
  - Message passing to service worker

### Priority 3: TTS Integration ✅
- [x] Implemented TTS API caller in service worker
  - POST to `https://api.openai.com/v1/audio/speech`
  - Supports `tts-1` and `tts-1-hd` models
  - Supports all 6 voices
  - Default: `tts-1` model, `nova` voice
- [x] Implemented smart text chunking (4000 char limit with sentence boundaries)
- [x] Implemented chunk stitching (MP3 concatenation)

### Priority 4: User Interface ✅
- [x] Created popup UI (`src/popup/`)
  - Article preview (title, word count, time estimate)
  - Convert button
  - Settings panel
  - Usage stats display
- [x] Created floating player (inline in content.js with Shadow DOM)
  - Play/pause, seek bar, speed selector (0.75x-2x)
  - Download button
  - Draggable positioning
  - Collapsible/expandable

### Priority 5: Storage & State ✅
- [x] Implemented storage schema in `src/lib/storage.js`
- [x] Implemented storage helpers (getSettings, setSettings, getUsage, incrementUsage)
- [x] Monthly usage reset on 1st of month

### Priority 6: Usage Limits ✅
- [x] 10 articles/month free tier limit
- [x] Usage display in popup
- [x] Upgrade prompt (links to waitlist)

### Priority 7: MP3 Download ✅
- [x] Basic download via chrome.downloads API
- [x] Filename sanitization

---

## Known Limitations / Future Work

### ID3 Metadata (Not Implemented)
- Current: MP3 downloads don't have ID3 tags
- Future: Add browser-id3-writer library for title/author/artwork

### Audio Caching (Not Implemented)
- Current: Audio not cached between sessions
- Future: IndexedDB caching for offline playback

### Edge Cases (Still Need Testing)
- [ ] Paywalled articles (should extract visible content only)
- [ ] Very long articles (10,000+ chars)
- [ ] Pages without articles
- [ ] Non-HTTP pages (chrome://, file://)

---

## Bug Fixes (v0.0.2)

1. **Blob URL Memory Leak Fixed** - Added automatic cleanup of blob URLs after 30 minutes via TTL mechanism in background.js. Object URLs are now properly revoked to prevent memory leaks.

2. **Tab ID Null Check Added** - Added validation for tab ID in convertArticle message handler. Returns proper error if tab ID cannot be determined.

3. **TTS API Timeout Added** - Added 60-second timeout for TTS API calls using AbortController to prevent indefinite hangs.

4. **Empty Filename Handling** - Improved filename sanitization to handle empty titles with fallback to 'article'.

5. **Async Download Fixed** - Fixed the download button handler to properly await the message response from background script.

6. **Division by Zero Guard** - Added guards for invalid audio duration in progress bar click handler and timeupdate handler.

---

## Deferred to v2

### Podcast Feed Feature
- Backend for RSS feed hosting (Cloudflare Workers + R2)
- Unique feed URL per user
- Currently: MP3 download serves as workaround

### Payment Integration
- Stripe subscription ($3/month or $25/year)
- Currently: Waitlist collection only

---

## Testing Instructions

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `src/` folder
5. Navigate to any article page
6. Click the extension icon
7. Enter your OpenAI API key (first time only)
8. Click "Convert to Audio"

### Test Sites
- NYTimes, Medium, Substack, TechCrunch, personal blogs

### Success Criteria
- Works on 90%+ of news/blog sites
- Audio sounds natural, not robotic
- Conversion completes in <30 seconds for average article
- One-click conversion from any article
- Floating player doesn't interfere with page content
