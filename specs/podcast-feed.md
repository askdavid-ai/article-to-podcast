# Personal Podcast Feed Spec (Differentiator)

## Job to Be Done
Generate a personal RSS podcast feed so users can listen to converted articles in their favorite podcast app (Pocket Casts, Overcast, Apple Podcasts).

## Why This Matters
- **Key differentiator** from ArticleCast, ArticleAudio, Speechify
- Competitors focus on in-browser listening
- Power users want articles in their existing podcast workflow
- Viral potential: "My articles appear in my podcast app automatically"

## Requirements

### Core Functionality
- Generate valid RSS 2.0 podcast feed
- Each converted article = one episode
- Feed hosted via simple static file or service worker
- One-click "Add to Podcast App" with feed URL

### Feed Structure
```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>My Article Podcast</title>
    <description>Articles converted to audio</description>
    <itunes:image href="[podcast-artwork-url]"/>
    <item>
      <title>[Article Title]</title>
      <description>[Article excerpt]</description>
      <pubDate>[Conversion date]</pubDate>
      <enclosure url="[audio-url]" type="audio/mpeg" length="[bytes]"/>
      <itunes:duration>[duration]</itunes:duration>
      <guid>[unique-id]</guid>
    </item>
  </channel>
</rss>
```

### Technical Approach (v1 - Simple)
1. Store converted audio as base64 in IndexedDB
2. Service worker serves feed.xml dynamically
3. Audio served via data URLs or blob URLs
4. Feed URL: `chrome-extension://[extension-id]/feed.xml`

**Limitation:** Most podcast apps can't access chrome-extension:// URLs

### Technical Approach (v2 - Backend Required)
1. Simple backend stores audio files + generates feed
2. User gets unique feed URL: `https://articlepod.io/feed/[user-id]`
3. Backend: Cloudflare Workers + R2 storage (cheap, scalable)
4. This enables true podcast app integration

### MVP Decision
**v1 for weekend build:** 
- Skip podcast feed for initial release
- Offer MP3 download (user can manually add to podcast app)
- Add backend + feed in v2 if traction

**v2 (post-launch):**
- Backend for feed hosting
- True podcast app integration
- This becomes the premium feature

## Success Criteria (v1)
- MP3 download works reliably
- Downloaded files have proper metadata (title, artwork)
- Clear path to v2 podcast feed feature
