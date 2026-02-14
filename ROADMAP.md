# Article to Podcast — Feature Roadmap

## Current Status (v0.1 - MVP)
- [x] One-click article extraction (Readability.js)
- [x] OpenAI TTS conversion
- [x] Floating player with controls
- [x] Speed control (0.75x - 2x)
- [x] MP3 download
- [x] Progress bar + time estimate during conversion
- [x] Audio persistence across page refresh
- [x] Free tier tracking (10 articles/month)

---

## Phase 1: Polish & Launch (Week 1-2)
Priority: Get to Chrome Web Store

- [ ] **Upgrade/Payment** — LemonSqueezy license key integration
- [ ] **Better content filtering** — Skip code blocks, tables, navigation
- [ ] **Error handling** — Better error messages, retry logic
- [ ] **Onboarding** — First-run tutorial/walkthrough
- [ ] **Settings page** — Full options page (not just popup)
- [ ] **Icon polish** — Professional extension icons
- [ ] **Chrome Web Store listing** — Screenshots, description, promo

---

## Phase 2: Core Features (Month 1)
Based on competitor analysis (Speechify, NaturalReader, ElevenReader)

### Voice Options
- [ ] **Multiple voices** — All 6 OpenAI voices with previews
- [ ] **ElevenLabs integration** — Premium voices (optional API key)
- [ ] **Voice cloning** — Clone your own voice (ElevenLabs)

### Speed & Playback
- [ ] **Extended speed range** — 0.5x to 3x
- [ ] **Keyboard shortcuts** — Space=play/pause, arrows=skip
- [ ] **Background playback** — Keep playing when tab closes
- [ ] **Sleep timer** — Auto-stop after X minutes

### Content Support
- [ ] **PDF support** — Upload or link to PDF
- [ ] **Selected text** — Convert highlighted text only
- [ ] **Full page vs article** — Option to read entire page

---

## Phase 3: Queue & Library (Month 2)
The "pocket for audio" experience

- [ ] **Reading queue** — Save articles to listen later
- [ ] **Listen history** — Track what you've listened to
- [ ] **Continue where you left off** — Resume playback position
- [ ] **Playlist mode** — Auto-play next article in queue
- [ ] **Offline mode** — Download for offline listening

---

## Phase 4: Podcast Feed (Month 2-3) ⭐ DIFFERENTIATOR
**This is our unique angle — no competitor does this well**

- [ ] **Personal RSS feed** — Your articles as a podcast
- [ ] **Backend service** — Host audio files + generate feed
- [ ] **Podcast app integration** — Works with Pocket Casts, Overcast, Apple Podcasts
- [ ] **Auto-add from queue** — Articles in queue → podcast feed
- [ ] **Custom podcast name/artwork** — Personalize your feed

---

## Phase 5: AI Enhancements (Month 3+)
Premium features for differentiation

- [ ] **AI Summary** — TL;DR before full article (listen to summary first)
- [ ] **Smart extraction** — Skip "subscribe to newsletter" prompts
- [ ] **Key points mode** — Extract and read only highlights
- [ ] **Translation** — Read articles in different languages
- [ ] **Conversation mode** — Two voices discussing the article (NotebookLM style)

---

## Phase 6: Platform Expansion (Month 4+)
- [ ] **iOS app** — Native mobile app
- [ ] **Android app** — Native mobile app  
- [ ] **Safari extension** — macOS/iOS Safari
- [ ] **Firefox extension** — Firefox support
- [ ] **Web app** — Paste URL to convert (no extension needed)
- [ ] **API** — Developer API for integrations

---

## Competitor Pricing Reference

| Product | Free Tier | Paid |
|---------|-----------|------|
| **Speechify** | Limited | $139/year |
| **NaturalReader** | 5 voices | $99/year |
| **ElevenReader** | Limited chars | $5-22/month |
| **Voice Dream** | N/A | $15 one-time |
| **ArticleAudio** | 2000 words | $5/month |
| **Us (target)** | 10 articles | $3/month or $25/year |

**Our advantage:** Cheapest paid tier + podcast feed feature nobody else has.

---

## Revenue Projections

### Conservative (1000 users)
- 5% conversion = 50 paid users
- $3/mo × 50 = **$150/mo MRR**

### Moderate (10,000 users)
- 5% conversion = 500 paid users  
- $3/mo × 500 = **$1,500/mo MRR**

### Optimistic (50,000 users)
- 5% conversion = 2,500 paid users
- $3/mo × 2,500 = **$7,500/mo MRR**

---

## Technical Debt / Improvements
- [ ] Migrate to Plasmo or WXT framework (better DX)
- [ ] Add unit tests
- [ ] Sentry error tracking
- [ ] Analytics (privacy-respecting)
- [ ] Automated Chrome Web Store deployments

---

*Last updated: Feb 4, 2026*
