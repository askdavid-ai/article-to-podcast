/**
 * Content script for Article to Podcast extension
 * Handles article extraction and player injection
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__articleToPodcastInjected) {
    return;
  }
  window.__articleToPodcastInjected = true;

  let floatingPlayer = null;
  let playerShadowRoot = null;

  // IndexedDB for audio persistence
  const DB_NAME = 'ArticleToPodcastDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'audioCache';

  /**
   * Open IndexedDB database
   */
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'url' });
        }
      };
    });
  }

  /**
   * Save audio to IndexedDB
   */
  async function saveAudioToCache(url, audioBlob, title) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      
      await new Promise((resolve, reject) => {
        const request = store.put({
          url: url,
          audio: audioBlob,
          title: title,
          timestamp: Date.now()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      db.close();
      console.log('Audio cached for:', url);
    } catch (e) {
      console.error('Failed to cache audio:', e);
    }
  }

  /**
   * Get audio from IndexedDB
   */
  async function getAudioFromCache(url) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      
      const result = await new Promise((resolve, reject) => {
        const request = store.get(url);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      db.close();
      return result;
    } catch (e) {
      console.error('Failed to get cached audio:', e);
      return null;
    }
  }

  /**
   * Clear audio from cache
   */
  async function clearAudioFromCache(url) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      
      await new Promise((resolve, reject) => {
        const request = store.delete(url);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      db.close();
    } catch (e) {
      console.error('Failed to clear cached audio:', e);
    }
  }

  // Podcast feed API endpoint (update this after deploying)
  const PODCAST_API_URL = 'https://article-podcast-api.articlepod.workers.dev';

  /**
   * Get or create user credentials for podcast feed
   */
  async function getOrCreateUserCredentials() {
    const storage = await chrome.storage.local.get(['podcastUserId', 'podcastUserSecret', 'podcastFeedUrl']);
    
    if (storage.podcastUserId && storage.podcastUserSecret) {
      return {
        userId: storage.podcastUserId,
        userSecret: storage.podcastUserSecret,
        feedUrl: storage.podcastFeedUrl
      };
    }
    
    // Create new user via API
    const response = await fetch(`${PODCAST_API_URL}/user/new`);
    const data = await response.json();
    
    // Store user credentials and feed URL
    await chrome.storage.local.set({
      podcastUserId: data.userId,
      podcastUserSecret: data.userSecret,
      podcastFeedUrl: data.feedUrl
    });
    
    return {
      userId: data.userId,
      userSecret: data.userSecret,
      feedUrl: data.feedUrl
    };
  }

  /**
   * Get stored feed URL
   */
  async function getFeedUrl() {
    const storage = await chrome.storage.local.get(['podcastFeedUrl']);
    return storage.podcastFeedUrl;
  }

  /**
   * Check for cached audio and restore player on page load
   */
  async function checkAndRestorePlayer() {
    const currentUrl = window.location.href;
    const cached = await getAudioFromCache(currentUrl);
    
    if (cached && cached.audio) {
      console.log('Restoring cached audio for:', currentUrl);
      
      // Create blob URL from cached audio
      const audioUrl = URL.createObjectURL(cached.audio);
      
      // Show player with cached audio
      showPlayer({ title: cached.title });
      
      if (window.__articleToPodcastPlayer) {
        window.__articleToPodcastPlayer.setAudio(audioUrl, cached.title);
      }
    }
  }

  /**
   * Extract article content from the current page using Readability
   * @returns {Object} Extracted article data
   */
  function extractArticle() {
    try {
      // Clone the document to avoid modifying the original
      const documentClone = document.cloneNode(true);

      // Check if Readability is available
      if (typeof Readability === 'undefined') {
        console.error('Readability.js not loaded');
        return fallbackExtraction();
      }

      const reader = new Readability(documentClone, {
        charThreshold: 100
      });

      const article = reader.parse();

      if (!article || !article.textContent) {
        console.warn('Readability failed to extract article, using fallback');
        return fallbackExtraction();
      }

      // Clean and format the text content
      const cleanedContent = cleanTextContent(article.textContent);
      const wordCount = countWords(cleanedContent);

      return {
        success: true,
        title: article.title || document.title || 'Untitled Article',
        author: article.byline || extractAuthor(),
        siteName: article.siteName || extractSiteName(),
        content: cleanedContent,
        wordCount: wordCount,
        estimatedReadTime: Math.ceil(wordCount / 200), // ~200 WPM average
        url: window.location.href
      };
    } catch (error) {
      console.error('Article extraction error:', error);
      return fallbackExtraction();
    }
  }

  /**
   * Fallback extraction when Readability fails
   * @returns {Object} Extracted article data
   */
  function fallbackExtraction() {
    try {
      // Try to find article content using common selectors
      const selectors = [
        'article',
        '[role="article"]',
        '.post-content',
        '.article-content',
        '.entry-content',
        '.content-body',
        'main',
        '.main-content'
      ];

      let contentElement = null;
      for (const selector of selectors) {
        contentElement = document.querySelector(selector);
        if (contentElement && contentElement.textContent.trim().length > 500) {
          break;
        }
      }

      if (!contentElement) {
        // Last resort: get body content
        contentElement = document.body;
      }

      // Extract text from paragraphs
      const paragraphs = contentElement.querySelectorAll('p');
      let content = '';

      paragraphs.forEach(p => {
        const text = p.textContent.trim();
        if (text.length > 50) { // Filter out short snippets
          content += text + '\n\n';
        }
      });

      if (!content.trim()) {
        return {
          success: false,
          error: 'Could not extract article content from this page'
        };
      }

      const cleanedContent = cleanTextContent(content);
      const wordCount = countWords(cleanedContent);

      return {
        success: true,
        title: document.title || 'Untitled Article',
        author: extractAuthor(),
        siteName: extractSiteName(),
        content: cleanedContent,
        wordCount: wordCount,
        estimatedReadTime: Math.ceil(wordCount / 200),
        url: window.location.href
      };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to extract article: ' + error.message
      };
    }
  }

  /**
   * Clean text content for TTS
   * @param {string} text - Raw text content
   * @returns {string} Cleaned text
   */
  function cleanTextContent(text) {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Replace multiple newlines with double newline (paragraph break)
      .replace(/\n\s*\n/g, '\n\n')
      // Remove URLs (they sound bad in TTS)
      .replace(/https?:\/\/[^\s]+/g, '')
      // Remove email addresses
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '')
      // Remove hex color codes (like #3a4861, #fff, etc.)
      .replace(/#[0-9a-fA-F]{3,8}\b/g, '')
      // Remove RGB/RGBA values
      .replace(/rgba?\([^)]+\)/gi, '')
      // Remove common navigation/UI text patterns
      .replace(/^(share|tweet|email|print|subscribe|newsletter|advertisement|sponsored)$/gim, '')
      // Remove standalone color names that appear to be labels (whole word matches in short context)
      .replace(/\b(sRGB|RGB|HSL|HEX|CMYK)\b/gi, '')
      // Remove lines that are just single words repeated (table headers/data)
      .replace(/^(\w+\s+){1,3}\w+$/gm, (match) => {
        // Keep if it looks like a sentence (has common words)
        if (/\b(the|a|an|is|are|was|were|be|been|have|has|had|do|does|did|will|would|could|should|may|might|must|and|or|but|if|then|because|when|where|what|how|why|who)\b/i.test(match)) {
          return match;
        }
        // Skip if all short words (likely table data)
        const words = match.trim().split(/\s+/);
        if (words.length <= 4 && words.every(w => w.length <= 10)) {
          return '';
        }
        return match;
      })
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Remove excessive punctuation
      .replace(/([.!?]){2,}/g, '$1')
      // Clean up multiple spaces/newlines created by removals
      .replace(/\n{3,}/g, '\n\n')
      .replace(/  +/g, ' ')
      // Trim
      .trim();
  }

  /**
   * Count words in text
   * @param {string} text - Text to count
   * @returns {number} Word count
   */
  function countWords(text) {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Try to extract author from meta tags
   * @returns {string|null} Author name or null
   */
  function extractAuthor() {
    const authorMeta = document.querySelector('meta[name="author"]') ||
                       document.querySelector('meta[property="article:author"]') ||
                       document.querySelector('[rel="author"]');

    if (authorMeta) {
      return authorMeta.content || authorMeta.textContent || null;
    }

    // Try JSON-LD
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        if (data.author) {
          return typeof data.author === 'string' ? data.author : data.author.name;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    return null;
  }

  /**
   * Try to extract site name from meta tags
   * @returns {string|null} Site name or null
   */
  function extractSiteName() {
    const siteMeta = document.querySelector('meta[property="og:site_name"]') ||
                     document.querySelector('meta[name="application-name"]');

    if (siteMeta) {
      return siteMeta.content || null;
    }

    // Fall back to domain name
    return window.location.hostname.replace('www.', '');
  }

  /**
   * Inject and show the floating player
   * @param {Object} options - Player options (audioUrl, title, etc.)
   */
  function showPlayer(options) {
    if (floatingPlayer) {
      updatePlayer(options);
      floatingPlayer.style.display = 'block';
      return;
    }

    // Create player container with shadow DOM for style isolation
    floatingPlayer = document.createElement('div');
    floatingPlayer.id = 'article-to-podcast-player';
    playerShadowRoot = floatingPlayer.attachShadow({ mode: 'closed' });

    // Inject player HTML and styles
    playerShadowRoot.innerHTML = getPlayerHTML(options);

    document.body.appendChild(floatingPlayer);
    initializePlayerControls(options);
  }

  /**
   * Update existing player with new audio
   * @param {Object} options - Player options
   */
  function updatePlayer(options) {
    if (!playerShadowRoot) return;

    const audio = playerShadowRoot.querySelector('audio');
    const titleEl = playerShadowRoot.querySelector('.player-title');

    if (audio && options.audioUrl) {
      audio.src = options.audioUrl;
    }
    if (titleEl && options.title) {
      titleEl.textContent = options.title;
    }

    initializePlayerControls(options);
  }

  /**
   * Hide the floating player
   */
  function hidePlayer() {
    if (floatingPlayer) {
      floatingPlayer.style.display = 'none';
    }
  }

  /**
   * Get player HTML template
   * @param {Object} options - Player options
   * @returns {string} HTML string
   */
  function getPlayerHTML(options) {
    return `
      <style>
        :host {
          all: initial;
        }

        .player-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 320px;
          background: #1a1a2e;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          z-index: 2147483647;
          overflow: hidden;
          transition: all 0.3s ease;
        }

        .player-container.collapsed {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          cursor: pointer;
        }

        .player-container.collapsed .player-content {
          display: none;
        }

        .player-container.collapsed .collapse-btn {
          display: none;
        }

        .player-container.collapsed .collapsed-icon {
          display: flex;
        }

        .collapsed-icon {
          display: none;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 24px;
        }

        .player-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: linear-gradient(135deg, #4F46E5, #7C3AED);
        }

        .player-title {
          color: white;
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px;
        }

        .header-buttons {
          display: flex;
          gap: 4px;
        }

        .collapse-btn, .close-btn {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px;
          font-size: 18px;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .collapse-btn:hover, .close-btn:hover {
          opacity: 1;
        }

        .close-btn:hover {
          color: #ef4444;
        }

        .player-content {
          padding: 16px;
        }

        .controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 16px;
        }

        .control-btn {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 20px;
          padding: 8px;
          border-radius: 50%;
          transition: background 0.2s, transform 0.1s;
        }

        .control-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .control-btn:active {
          transform: scale(0.95);
        }

        .play-btn {
          font-size: 28px;
          background: #4F46E5;
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .play-btn:hover {
          background: #6366F1;
        }

        .progress-container {
          margin-bottom: 12px;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: #333;
          border-radius: 3px;
          cursor: pointer;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4F46E5, #7C3AED);
          width: 0%;
          transition: width 0.1s linear;
        }

        .time-display {
          display: flex;
          justify-content: space-between;
          color: #888;
          font-size: 11px;
          margin-top: 4px;
        }

        .bottom-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .speed-control {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .speed-btn {
          background: #333;
          border: none;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .speed-btn:hover {
          background: #444;
        }

        .speed-btn.active {
          background: #4F46E5;
        }

        .action-buttons {
          display: flex;
          gap: 8px;
        }

        .download-btn, .podcast-btn {
          background: none;
          border: 1px solid #4F46E5;
          color: #4F46E5;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .download-btn:hover, .podcast-btn:hover {
          background: #4F46E5;
          color: white;
        }

        .podcast-btn.added {
          background: #10B981;
          border-color: #10B981;
          color: white;
        }

        .podcast-btn.added:hover {
          background: #059669;
        }

        audio {
          display: none;
        }

        .loading {
          display: none;
          text-align: center;
          padding: 20px;
          color: white;
        }

        .loading.visible {
          display: block;
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #333;
          border-top-color: #4F46E5;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 12px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .conversion-progress {
          margin-top: 12px;
          width: 100%;
        }

        .conversion-progress-bar {
          height: 4px;
          background: #333;
          border-radius: 2px;
          overflow: hidden;
        }

        .conversion-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4F46E5, #7C3AED);
          width: 0%;
          transition: width 0.3s ease;
        }

        .conversion-time {
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          font-size: 11px;
          color: #888;
        }

        .elapsed-time, .estimated-time {
          font-variant-numeric: tabular-nums;
        }

        .error-message {
          display: none;
          text-align: center;
          padding: 16px;
          color: #ef4444;
          font-size: 13px;
        }

        .error-message.visible {
          display: block;
        }
      </style>

      <div class="player-container">
        <div class="collapsed-icon">🎧</div>

        <div class="player-header">
          <span class="player-title">${options.title || 'Now Playing'}</span>
          <div class="header-buttons">
            <button class="collapse-btn" title="Minimize">−</button>
            <button class="close-btn" title="Close">×</button>
          </div>
        </div>

        <div class="player-content">
          <div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">Converting to audio...</div>
            <div class="conversion-progress">
              <div class="conversion-progress-bar">
                <div class="conversion-progress-fill"></div>
              </div>
              <div class="conversion-time">
                <span class="elapsed-time"></span>
                <span class="estimated-time"></span>
              </div>
            </div>
          </div>

          <div class="error-message"></div>

          <div class="controls">
            <button class="control-btn rewind-btn" title="Rewind 15s">⏪</button>
            <button class="control-btn play-btn" title="Play">▶</button>
            <button class="control-btn forward-btn" title="Forward 15s">⏩</button>
          </div>

          <div class="progress-container">
            <div class="progress-bar">
              <div class="progress-fill"></div>
            </div>
            <div class="time-display">
              <span class="current-time">0:00</span>
              <span class="duration">0:00</span>
            </div>
          </div>

          <div class="bottom-controls">
            <div class="speed-control">
              <button class="speed-btn" data-speed="0.75">0.75x</button>
              <button class="speed-btn active" data-speed="1">1x</button>
              <button class="speed-btn" data-speed="1.5">1.5x</button>
              <button class="speed-btn" data-speed="2">2x</button>
            </div>
            <div class="action-buttons">
              <button class="podcast-btn" title="Add to Podcast Feed">
                🎙️ Podcast
              </button>
              <button class="download-btn" title="Download MP3">
                ⬇ MP3
              </button>
            </div>
          </div>
        </div>

        <audio></audio>
      </div>
    `;
  }

  /**
   * Initialize player control event listeners
   * @param {Object} options - Player options
   */
  function initializePlayerControls(options) {
    if (!playerShadowRoot) return;

    const container = playerShadowRoot.querySelector('.player-container');
    const audio = playerShadowRoot.querySelector('audio');
    const playBtn = playerShadowRoot.querySelector('.play-btn');
    const rewindBtn = playerShadowRoot.querySelector('.rewind-btn');
    const forwardBtn = playerShadowRoot.querySelector('.forward-btn');
    const progressBar = playerShadowRoot.querySelector('.progress-bar');
    const progressFill = playerShadowRoot.querySelector('.progress-fill');
    const currentTimeEl = playerShadowRoot.querySelector('.current-time');
    const durationEl = playerShadowRoot.querySelector('.duration');
    const speedBtns = playerShadowRoot.querySelectorAll('.speed-btn');
    const downloadBtn = playerShadowRoot.querySelector('.download-btn');
    const podcastBtn = playerShadowRoot.querySelector('.podcast-btn');
    const collapseBtn = playerShadowRoot.querySelector('.collapse-btn');
    const closeBtn = playerShadowRoot.querySelector('.close-btn');
    const collapsedIcon = playerShadowRoot.querySelector('.collapsed-icon');
    const loading = playerShadowRoot.querySelector('.loading');
    const loadingText = playerShadowRoot.querySelector('.loading-text');
    const conversionProgressFill = playerShadowRoot.querySelector('.conversion-progress-fill');
    const elapsedTimeEl = playerShadowRoot.querySelector('.elapsed-time');
    const estimatedTimeEl = playerShadowRoot.querySelector('.estimated-time');
    
    // Time tracking for conversion
    let conversionStartTime = null;
    let elapsedTimeInterval = null;
    const errorMessage = playerShadowRoot.querySelector('.error-message');
    const controls = playerShadowRoot.querySelector('.controls');
    const bottomControls = playerShadowRoot.querySelector('.bottom-controls');
    const progressContainer = playerShadowRoot.querySelector('.progress-container');

    // Set audio source if provided
    if (options.audioUrl) {
      audio.src = options.audioUrl;
      showControls();
    }

    // Helper functions
    function formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    function showLoading(text) {
      loadingText.textContent = text || 'Converting to audio...';
      loading.classList.add('visible');
      controls.style.display = 'none';
      progressContainer.style.display = 'none';
      bottomControls.style.display = 'none';
      errorMessage.classList.remove('visible');
      
      // Start time tracking if not already started
      if (!conversionStartTime) {
        conversionStartTime = Date.now();
        elapsedTimeEl.textContent = 'Elapsed: 0s';
        estimatedTimeEl.textContent = '';
        
        // Update elapsed time every second
        elapsedTimeInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - conversionStartTime) / 1000);
          elapsedTimeEl.textContent = `Elapsed: ${formatTime(elapsed)}`;
        }, 1000);
      }
      
      // Update progress bar if text contains progress info like "(2/5)"
      const progressMatch = text && text.match(/\((\d+)\/(\d+)\)/);
      if (progressMatch) {
        const current = parseInt(progressMatch[1]);
        const total = parseInt(progressMatch[2]);
        const percent = Math.round((current / total) * 100);
        conversionProgressFill.style.width = percent + '%';
        
        // Estimate remaining time
        if (conversionStartTime) {
          const elapsed = (Date.now() - conversionStartTime) / 1000;
          
          if (current <= 1) {
            // First chunk - use conservative estimate of ~8 seconds per chunk
            const estimatedTotal = total * 8;
            const remaining = Math.max(0, estimatedTotal - elapsed);
            estimatedTimeEl.textContent = `~${formatTime(remaining)} remaining`;
          } else {
            // After first chunk, calculate based on actual timing
            const timePerChunk = elapsed / current;
            const remaining = Math.ceil(timePerChunk * (total - current));
            // Add 20% buffer to be conservative
            const conservativeRemaining = Math.ceil(remaining * 1.2);
            estimatedTimeEl.textContent = `~${formatTime(conservativeRemaining)} remaining`;
          }
        }
      } else if (text && text.includes('Preparing')) {
        conversionProgressFill.style.width = '95%';
        estimatedTimeEl.textContent = 'Almost done...';
      } else if (text && text.includes('Extracting')) {
        conversionProgressFill.style.width = '5%';
        estimatedTimeEl.textContent = 'Estimating...';
      }
    }

    function stopTimeTracking() {
      if (elapsedTimeInterval) {
        clearInterval(elapsedTimeInterval);
        elapsedTimeInterval = null;
      }
      conversionStartTime = null;
    }

    function showControls() {
      stopTimeTracking();
      loading.classList.remove('visible');
      controls.style.display = 'flex';
      progressContainer.style.display = 'block';
      bottomControls.style.display = 'flex';
      errorMessage.classList.remove('visible');
    }

    function showError(message) {
      stopTimeTracking();
      loading.classList.remove('visible');
      errorMessage.textContent = message;
      errorMessage.classList.add('visible');
      controls.style.display = 'none';
      progressContainer.style.display = 'none';
      bottomControls.style.display = 'none';
    }

    function formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Play/Pause
    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        audio.play();
        playBtn.textContent = '⏸';
      } else {
        audio.pause();
        playBtn.textContent = '▶';
      }
    });

    // Rewind 15s
    rewindBtn.addEventListener('click', () => {
      audio.currentTime = Math.max(0, audio.currentTime - 15);
    });

    // Forward 15s
    forwardBtn.addEventListener('click', () => {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
    });

    // Progress bar click
    progressBar.addEventListener('click', (e) => {
      // Guard against invalid duration
      if (!audio.duration || isNaN(audio.duration) || audio.duration === 0) return;

      const rect = progressBar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      audio.currentTime = percent * audio.duration;
    });

    // Update progress
    audio.addEventListener('timeupdate', () => {
      // Guard against invalid duration
      if (!audio.duration || isNaN(audio.duration) || audio.duration === 0) return;

      const percent = (audio.currentTime / audio.duration) * 100;
      progressFill.style.width = percent + '%';
      currentTimeEl.textContent = formatTime(audio.currentTime);
    });

    // Duration loaded
    audio.addEventListener('loadedmetadata', () => {
      durationEl.textContent = formatTime(audio.duration);
    });

    // Audio ended
    audio.addEventListener('ended', () => {
      playBtn.textContent = '▶';
      progressFill.style.width = '0%';
      audio.currentTime = 0;
    });

    // Speed buttons
    speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        audio.playbackRate = parseFloat(btn.dataset.speed);
      });
    });

    // Download
    downloadBtn.addEventListener('click', async () => {
      const audioUrl = window.__articleToPodcastAudioUrl || audio.src;
      if (!audioUrl) return;

      try {
        // For blob URLs, we can trigger download directly
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = (window.__articleToPodcastTitle || options.title || 'article') + '.mp3';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (error) {
        console.error('Download error:', error);
        // Fallback to background script download
        try {
          await chrome.runtime.sendMessage({
            action: 'downloadAudio',
            url: audioUrl,
            filename: window.__articleToPodcastTitle || options.title || 'article'
          });
        } catch (bgError) {
          console.error('Background download also failed:', bgError);
        }
      }
    });

    // Add to Podcast Feed
    podcastBtn.addEventListener('click', async () => {
      const audioUrl = window.__articleToPodcastAudioUrl || audio.src;
      if (!audioUrl) return;

      // Check if already added
      if (podcastBtn.classList.contains('added')) {
        // Show feed URL
        const feedUrl = await getFeedUrl();
        if (feedUrl) {
          prompt('Your podcast feed URL (add to your podcast app):', feedUrl);
        }
        return;
      }

      podcastBtn.textContent = '⏳ Adding...';
      podcastBtn.disabled = true;

      try {
        // Get or create user credentials
        const credentials = await getOrCreateUserCredentials();
        
        // Fetch audio blob from URL
        const response = await fetch(audioUrl);
        const audioBlob = await response.blob();
        
        // Get audio duration
        const duration = Math.round(audio.duration) || 0;
        
        // Upload to backend
        const formData = new FormData();
        formData.append('audio', audioBlob, 'article.mp3');
        formData.append('userId', credentials.userId);
        formData.append('userSecret', credentials.userSecret);
        formData.append('title', window.__articleToPodcastTitle || options.title || 'Untitled Article');
        formData.append('sourceUrl', window.location.href);
        formData.append('duration', duration.toString());

        const uploadResponse = await fetch(`${PODCAST_API_URL}/upload`, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({}));
          throw new Error(errorData.error || 'Upload failed');
        }

        const result = await uploadResponse.json();
        
        // Update button state
        podcastBtn.textContent = '✓ Added';
        podcastBtn.classList.add('added');
        podcastBtn.disabled = false;

        // Store feed URL
        await chrome.storage.local.set({ podcastFeedUrl: result.feedUrl });
        
        // Copy to clipboard automatically
        try {
          await navigator.clipboard.writeText(result.feedUrl);
        } catch (e) {
          console.log('Could not auto-copy feed URL');
        }
        
        // Show instructions popup
        setTimeout(() => {
          const instructions = `✅ Added to your podcast feed!

Your feed URL (copied to clipboard):
${result.feedUrl}

📱 HOW TO ADD TO YOUR PODCAST APP:

APPLE PODCASTS:
1. Open Apple Podcasts → Library → ⋯ menu
2. "Add a Show by URL" → Paste your feed URL

POCKET CASTS:
1. Open Pocket Casts → Search tab
2. Tap "Submit RSS" → Paste your feed URL

OVERCAST:
1. Open Overcast → Add Podcast
2. Tap "Add URL" → Paste your feed URL

SPOTIFY:
(Spotify doesn't support custom RSS feeds)

💡 TIP: Your feed URL is always available in the extension Settings (⚙️)`;
          
          alert(instructions);
        }, 300);

      } catch (error) {
        console.error('Podcast upload error:', error);
        console.error('Error details:', error.message, error.stack);
        podcastBtn.textContent = '🎙️ Podcast';
        podcastBtn.disabled = false;
        alert('Failed to add to podcast feed: ' + (error.message || 'Unknown error'));
      }
    });

    // Collapse/Expand
    collapseBtn.addEventListener('click', () => {
      container.classList.add('collapsed');
    });

    collapsedIcon.addEventListener('click', () => {
      container.classList.remove('collapsed');
    });

    // Close button - remove player and clear cache
    closeBtn.addEventListener('click', async () => {
      // Clear cached audio for this page
      await clearAudioFromCache(window.location.href);
      // Remove the player
      hidePlayer();
    });

    // Make draggable
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('.progress-bar')) return;
      isDragging = true;
      const rect = container.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      container.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
      container.style.left = x + 'px';
      container.style.top = y + 'px';
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      container.style.transition = '';
    });

    // Expose methods for external control
    window.__articleToPodcastPlayer = {
      showLoading,
      showControls,
      showError,
      setAudio: (url, title) => {
        audio.src = url;
        // Store URL and title for download
        window.__articleToPodcastAudioUrl = url;
        window.__articleToPodcastTitle = title || 'article';
        showControls();
      }
    };
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'extractArticle':
        const article = extractArticle();
        sendResponse(article);
        break;

      case 'showPlayer':
        showPlayer(message.options || {});
        sendResponse({ success: true });
        break;

      case 'hidePlayer':
        hidePlayer();
        sendResponse({ success: true });
        break;

      case 'updatePlayerStatus':
        if (window.__articleToPodcastPlayer) {
          if (message.status === 'loading') {
            window.__articleToPodcastPlayer.showLoading(message.text);
          } else if (message.status === 'ready') {
            // Handle base64 audio data - create blob URL in content script context
            let audioUrl = message.audioUrl;
            let audioBlob = null;
            if (message.audioBase64) {
              try {
                const binaryString = atob(message.audioBase64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
                audioUrl = URL.createObjectURL(audioBlob);
                
                // Cache the audio for persistence across page refreshes
                saveAudioToCache(window.location.href, audioBlob, message.title);
              } catch (e) {
                console.error('Failed to create audio blob:', e);
                window.__articleToPodcastPlayer.showError('Failed to process audio');
                break;
              }
            }
            window.__articleToPodcastPlayer.setAudio(audioUrl, message.title);
          } else if (message.status === 'error') {
            window.__articleToPodcastPlayer.showError(message.error);
          }
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }

    return true; // Keep message channel open for async response
  });

  // Log successful injection
  console.log('Article to Podcast: Content script loaded');

  // Check for cached audio and restore player if available
  checkAndRestorePlayer();
})();
