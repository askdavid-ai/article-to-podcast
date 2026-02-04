# TTS Conversion Spec

## Job to Be Done
Convert extracted article text into natural-sounding audio using high-quality TTS APIs.

## Requirements

### Core Functionality
- Convert article text to audio via OpenAI TTS API
- Support multiple voice options (alloy, echo, fable, onyx, nova, shimmer)
- Handle long articles by chunking (API has 4096 char limit)
- Stitch chunks seamlessly into single audio file

### Technical Approach
- OpenAI TTS API (`tts-1` model for speed, `tts-1-hd` for quality)
- Default: `tts-1` with `nova` voice (warm, clear)
- Chunk text at sentence boundaries to avoid mid-word cuts
- Return audio as base64 or blob URL for playback

### API Details
```typescript
// OpenAI TTS endpoint
POST https://api.openai.com/v1/audio/speech
{
  model: "tts-1",
  input: "text to convert",
  voice: "nova",
  response_format: "mp3"
}
```

### Cost Management
- OpenAI TTS: $15 per 1M characters
- Average article: ~5,000 chars = ~$0.075 per article
- Track usage for free tier limits

### Configuration
- Voice selection (user preference, stored in extension storage)
- Speed: 1.0x default (OpenAI doesn't support speed adjustment in API, handle in player)
- Quality: tts-1 (fast) vs tts-1-hd (quality) - user selectable

## Success Criteria
- Audio sounds natural, not robotic
- Long articles (10,000+ chars) convert without errors
- Conversion completes in <30 seconds for average article
