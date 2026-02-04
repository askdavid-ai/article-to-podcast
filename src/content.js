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
      // Remove common navigation/UI text patterns
      .replace(/^(share|tweet|email|print|subscribe|newsletter|advertisement|sponsored)$/gim, '')
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Remove excessive punctuation
      .replace(/([.!?]){2,}/g, '$1')
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

        .collapse-btn {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px;
          font-size: 18px;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .collapse-btn:hover {
          opacity: 1;
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

        .download-btn {
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

        .download-btn:hover {
          background: #4F46E5;
          color: white;
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
          <button class="collapse-btn" title="Minimize">−</button>
        </div>

        <div class="player-content">
          <div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">Converting to audio...</div>
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
            <button class="download-btn" title="Download MP3">
              ⬇ MP3
            </button>
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
    const collapseBtn = playerShadowRoot.querySelector('.collapse-btn');
    const collapsedIcon = playerShadowRoot.querySelector('.collapsed-icon');
    const loading = playerShadowRoot.querySelector('.loading');
    const loadingText = playerShadowRoot.querySelector('.loading-text');
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
    function showLoading(text) {
      loadingText.textContent = text || 'Converting to audio...';
      loading.classList.add('visible');
      controls.style.display = 'none';
      progressContainer.style.display = 'none';
      bottomControls.style.display = 'none';
      errorMessage.classList.remove('visible');
    }

    function showControls() {
      loading.classList.remove('visible');
      controls.style.display = 'flex';
      progressContainer.style.display = 'block';
      bottomControls.style.display = 'flex';
      errorMessage.classList.remove('visible');
    }

    function showError(message) {
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
      if (!audio.src) return;

      try {
        // Send message to background to handle download
        const response = await chrome.runtime.sendMessage({
          action: 'downloadAudio',
          url: audio.src,
          filename: options.filename || options.title || 'article'
        });
        if (response && !response.success) {
          console.error('Download failed:', response.error);
        }
      } catch (error) {
        console.error('Download error:', error);
      }
    });

    // Collapse/Expand
    collapseBtn.addEventListener('click', () => {
      container.classList.add('collapsed');
    });

    collapsedIcon.addEventListener('click', () => {
      container.classList.remove('collapsed');
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
      setAudio: (url) => {
        audio.src = url;
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
            window.__articleToPodcastPlayer.setAudio(message.audioUrl);
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
})();
