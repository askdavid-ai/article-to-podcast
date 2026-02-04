# Article-to-Podcast Chrome Extension

One-click article-to-audio conversion for Chrome. Key differentiator: MP3 export (future: personal podcast feed).

## Stack
- Chrome Extension (Manifest V3)
- Readability.js (article extraction)
- OpenAI TTS API (text-to-speech)
- Vanilla JS (no framework needed for extension)

## Structure
```
src/
├── manifest.json
├── background.js       # Service worker, API calls
├── content.js          # Article extraction, player injection
├── popup/              # Extension popup UI
├── player/             # Floating audio player
├── lib/                # Readability.js
└── icons/
```

## Commands

### Build
```bash
# No build step needed - plain JS
# Just ensure manifest.json is valid
cat src/manifest.json | jq . > /dev/null && echo "Manifest valid"
```

### Test
```bash
# Manual testing: Load unpacked extension in chrome://extensions
# Automated: None for v1 (extension APIs hard to mock)
echo "Load src/ as unpacked extension in Chrome"
```

### Lint
```bash
# Check JS syntax
npx eslint src/**/*.js --no-eslintrc --env browser,webextensions 2>/dev/null || echo "Install eslint for linting"
```

## API Keys
- OpenAI API key required for TTS
- User provides their own key, OR
- Backend proxy with our key (v2)

## Key Files
- `specs/` - Requirements and decisions
- `IMPLEMENTATION_PLAN.md` - Current task list
- `src/` - Extension source code
