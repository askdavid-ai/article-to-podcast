# Chrome Extension Architecture Spec

## Job to Be Done
Provide seamless one-click article-to-audio conversion directly in the browser.

## Requirements

### Manifest V3 Structure
```
extension/
├── manifest.json
├── background.js          # Service worker
├── content.js             # Content script (extraction)
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── player/
│   ├── player.html        # Floating player (injected)
│   ├── player.js
│   └── player.css
├── lib/
│   └── Readability.js     # Mozilla's extraction lib
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### User Flow
1. User navigates to article page
2. Clicks extension icon in toolbar
3. Popup shows: article title, estimated time, "Convert" button
4. Click Convert → extraction → TTS → floating player appears
5. Player: play/pause, progress, speed control, download MP3

### Components

#### Service Worker (background.js)
- Handle TTS API calls (needs API key)
- Manage conversion queue
- Store user preferences and usage stats

#### Content Script (content.js)
- Run Readability.js on current page
- Inject floating player into page
- Message passing with service worker

#### Popup (popup/)
- Show article preview (title, word count, time estimate)
- Convert button
- Settings link
- Usage stats (X of Y free articles remaining)

#### Floating Player (player/)
- Minimalist design, bottom-right corner
- Play/pause, seek bar, speed (0.5x-2x), download
- Draggable, collapsible
- Persists across page navigation (within tab)

### Permissions Required
```json
{
  "permissions": [
    "activeTab",
    "storage"
  ],
  "host_permissions": [
    "https://api.openai.com/*"
  ]
}
```

### Storage Schema
```typescript
interface ExtensionStorage {
  apiKey?: string;              // User's OpenAI key (Pro feature)
  voice: string;                // Selected voice
  speed: number;                // Playback speed
  freeArticlesUsed: number;     // This month
  freeArticlesResetDate: string;// ISO date
  history: ConvertedArticle[];  // Recent conversions
}
```

## Success Criteria
- One-click conversion from any article
- Floating player doesn't interfere with page content
- Works offline for previously converted articles (cached audio)
