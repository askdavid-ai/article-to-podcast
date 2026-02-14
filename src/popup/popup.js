/**
 * Popup script for Article to Podcast extension
 * No API key required - uses backend service
 */

// DOM Elements
const elements = {
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),
  articlePreview: document.getElementById('article-preview'),
  articleTitle: document.getElementById('article-title'),
  articleAuthor: document.getElementById('article-author'),
  articleSite: document.getElementById('article-site'),
  wordCount: document.getElementById('word-count'),
  readTime: document.getElementById('read-time'),
  voiceSelect: document.getElementById('voice-select'),
  convertBtn: document.getElementById('convert-btn'),
  conversionProgress: document.getElementById('conversion-progress'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  usageFooter: document.getElementById('usage-footer'),
  usageText: document.getElementById('usage-text'),
  upgradeBtn: document.getElementById('upgrade-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsPanel: document.getElementById('settings-panel'),
  closeSettings: document.getElementById('close-settings'),
  modelSelect: document.getElementById('model-select'),
  feedUrl: document.getElementById('feed-url'),
  copyFeedBtn: document.getElementById('copy-feed-btn'),
  saveSettings: document.getElementById('save-settings'),
  limitModal: document.getElementById('limit-modal'),
  closeModal: document.getElementById('close-modal')
};

// Current article data
let currentArticle = null;
let currentTab = null;

/**
 * Initialize popup
 */
async function init() {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    // Check if we're on a valid page
    if (!tab.url || !tab.url.startsWith('http')) {
      showError('This extension only works on web pages.');
      return;
    }

    // Set up event listeners
    setupEventListeners();

    // Load settings
    const settings = await getSettings();
    elements.voiceSelect.value = settings.voice || 'nova';
    elements.modelSelect.value = settings.model || 'tts-1';

    // Load feed URL if available
    const storage = await chrome.storage.local.get(['podcastFeedUrl']);
    if (storage.podcastFeedUrl) {
      elements.feedUrl.value = storage.podcastFeedUrl;
    }

    // Extract article from page
    await extractArticle();

    // Load usage stats
    await loadUsageStats();
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize. Please try again.');
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Retry button
  elements.retryBtn.addEventListener('click', async () => {
    showLoading();
    await extractArticle();
  });

  // Voice selection
  elements.voiceSelect.addEventListener('change', async () => {
    await saveSettings({ voice: elements.voiceSelect.value });
  });

  // Convert button
  elements.convertBtn.addEventListener('click', handleConvert);

  // Settings panel
  elements.settingsBtn.addEventListener('click', async () => {
    // Refresh feed URL
    const storage = await chrome.storage.local.get(['podcastFeedUrl']);
    if (storage.podcastFeedUrl) {
      elements.feedUrl.value = storage.podcastFeedUrl;
    }
    elements.settingsPanel.classList.remove('hidden');
  });

  elements.closeSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });

  // Copy feed URL
  elements.copyFeedBtn.addEventListener('click', async () => {
    const feedUrl = elements.feedUrl.value;
    if (feedUrl) {
      await navigator.clipboard.writeText(feedUrl);
      elements.copyFeedBtn.textContent = 'Copied!';
      setTimeout(() => {
        elements.copyFeedBtn.textContent = 'Copy';
      }, 2000);
    }
  });

  // Save settings
  elements.saveSettings.addEventListener('click', async () => {
    await saveSettings({ model: elements.modelSelect.value });
    elements.settingsPanel.classList.add('hidden');
  });

  // Upgrade button
  elements.upgradeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://articlepod.app/upgrade' });
  });

  // Close modal
  elements.closeModal.addEventListener('click', () => {
    elements.limitModal.classList.add('hidden');
  });

  // Handle external links
  document.querySelectorAll('a[target="_blank"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.href });
    });
  });
}

/**
 * Extract article from current page
 */
async function extractArticle() {
  showLoading();

  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, {
      action: 'extractArticle'
    });

    if (!response || !response.success) {
      showError(response?.error || 'Could not extract article from this page.');
      return;
    }

    currentArticle = response;
    showArticlePreview(response);
  } catch (error) {
    console.error('Extraction error:', error);

    if (error.message.includes('Receiving end does not exist')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          files: ['lib/Readability.js', 'content.js']
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await extractArticle();
        return;
      } catch (injectError) {
        console.error('Failed to inject content script:', injectError);
        showError('Please refresh the page and try again.');
      }
    } else {
      showError('Failed to analyze this page.');
    }
  }
}

/**
 * Handle convert button click
 */
async function handleConvert() {
  if (!currentArticle) return;

  const canConvert = await checkCanConvert();
  if (!canConvert) {
    elements.limitModal.classList.remove('hidden');
    return;
  }

  elements.convertBtn.disabled = true;
  elements.conversionProgress.classList.remove('hidden');
  updateProgress(0, 'Starting conversion...');

  try {
    const voice = elements.voiceSelect.value;
    await saveSettings({ voice });

    await chrome.runtime.sendMessage({
      action: 'convertArticle',
      article: { ...currentArticle, voice },
      tabId: currentTab.id
    });

    setTimeout(() => window.close(), 500);
  } catch (error) {
    console.error('Conversion error:', error);
    elements.convertBtn.disabled = false;
    elements.conversionProgress.classList.add('hidden');
    showError('Conversion failed. Please try again.');
  }
}

function showLoading() {
  elements.loading.classList.remove('hidden');
  elements.error.classList.add('hidden');
  elements.articlePreview.classList.add('hidden');
  elements.usageFooter.classList.add('hidden');
}

function showError(message) {
  elements.loading.classList.add('hidden');
  elements.error.classList.remove('hidden');
  elements.articlePreview.classList.add('hidden');
  elements.usageFooter.classList.add('hidden');
  elements.errorMessage.textContent = message;
}

function showArticlePreview(article) {
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.articlePreview.classList.remove('hidden');
  elements.usageFooter.classList.remove('hidden');

  elements.articleTitle.textContent = article.title;
  elements.articleAuthor.textContent = article.author || '';
  elements.articleSite.textContent = article.siteName || '';
  elements.wordCount.textContent = article.wordCount.toLocaleString();
  elements.readTime.textContent = article.estimatedReadTime;
}

function updateProgress(percent, text) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
}

async function loadUsageStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getUsage' });
    if (response.success) {
      const { articlesRemaining, limit } = response.usage;
      elements.usageText.textContent = `${articlesRemaining} of ${limit} free articles remaining`;
      if (articlesRemaining <= 3) {
        elements.upgradeBtn.classList.remove('hidden');
      }
    }
  } catch (error) {
    console.error('Failed to load usage stats:', error);
  }
}

async function checkCanConvert() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'canConvert' });
    return response.success && response.canConvert;
  } catch (error) {
    return false;
  }
}

async function getSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    return response.success ? response.settings : {};
  } catch (error) {
    return {};
  }
}

async function saveSettings(settings) {
  try {
    await chrome.runtime.sendMessage({ action: 'setSettings', settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

document.addEventListener('DOMContentLoaded', init);
