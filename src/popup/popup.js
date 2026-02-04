/**
 * Popup script for Article to Podcast extension
 * Handles UI interactions and communication with background/content scripts
 */

// DOM Elements
const elements = {
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),
  noApiKey: document.getElementById('no-api-key'),
  apiKeyInput: document.getElementById('api-key-input'),
  saveApiKeyBtn: document.getElementById('save-api-key'),
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
  settingsApiKey: document.getElementById('settings-api-key'),
  modelSelect: document.getElementById('model-select'),
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

    // Load settings and check for API key
    const settings = await getSettings();

    if (!settings.apiKey) {
      showNoApiKey();
      return;
    }

    // Load voice preference
    elements.voiceSelect.value = settings.voice || 'nova';
    elements.modelSelect.value = settings.model || 'tts-1';
    elements.settingsApiKey.value = settings.apiKey ? '••••••••' : '';

    // Extract article from page
    await extractArticle();

    // Load usage stats
    await loadUsageStats();

    // Set up event listeners
    setupEventListeners();
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

  // Save API key (initial setup)
  elements.saveApiKeyBtn.addEventListener('click', async () => {
    const apiKey = elements.apiKeyInput.value.trim();
    if (!apiKey || !apiKey.startsWith('sk-')) {
      alert('Please enter a valid OpenAI API key (starts with sk-)');
      return;
    }

    await saveSettings({ apiKey });
    location.reload();
  });

  // Voice selection
  elements.voiceSelect.addEventListener('change', async () => {
    await saveSettings({ voice: elements.voiceSelect.value });
  });

  // Convert button
  elements.convertBtn.addEventListener('click', handleConvert);

  // Settings panel
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsPanel.classList.remove('hidden');
  });

  elements.closeSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });

  // Save settings
  elements.saveSettings.addEventListener('click', async () => {
    const newApiKey = elements.settingsApiKey.value.trim();
    const updates = {
      model: elements.modelSelect.value
    };

    // Only update API key if it's been changed (not showing dots)
    if (newApiKey && !newApiKey.includes('•') && newApiKey.startsWith('sk-')) {
      updates.apiKey = newApiKey;
    }

    await saveSettings(updates);
    elements.settingsPanel.classList.add('hidden');
  });

  // Upgrade button
  elements.upgradeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://example.com/waitlist' });
  });

  // Close modal
  elements.closeModal.addEventListener('click', () => {
    elements.limitModal.classList.add('hidden');
  });
}

/**
 * Extract article from current page
 */
async function extractArticle() {
  showLoading();

  try {
    // Send message to content script
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

    // Content script might not be injected yet
    if (error.message.includes('Receiving end does not exist')) {
      showError('Please refresh the page and try again.');
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

  // Check if user can convert
  const canConvert = await checkCanConvert();
  if (!canConvert) {
    elements.limitModal.classList.remove('hidden');
    return;
  }

  // Disable convert button and show progress
  elements.convertBtn.disabled = true;
  elements.conversionProgress.classList.remove('hidden');
  updateProgress(0, 'Starting conversion...');

  try {
    // Get current voice setting
    const voice = elements.voiceSelect.value;
    await saveSettings({ voice });

    // Send conversion request to background
    await chrome.runtime.sendMessage({
      action: 'convertArticle',
      article: {
        ...currentArticle,
        voice
      }
    });

    // The player will appear in the page via content script
    // Close popup after a short delay
    setTimeout(() => {
      window.close();
    }, 500);
  } catch (error) {
    console.error('Conversion error:', error);
    elements.convertBtn.disabled = false;
    elements.conversionProgress.classList.add('hidden');
    showError('Conversion failed. Please try again.');
  }
}

/**
 * Show loading state
 */
function showLoading() {
  elements.loading.classList.remove('hidden');
  elements.error.classList.add('hidden');
  elements.noApiKey.classList.add('hidden');
  elements.articlePreview.classList.add('hidden');
  elements.usageFooter.classList.add('hidden');
}

/**
 * Show error state
 * @param {string} message - Error message to display
 */
function showError(message) {
  elements.loading.classList.add('hidden');
  elements.error.classList.remove('hidden');
  elements.noApiKey.classList.add('hidden');
  elements.articlePreview.classList.add('hidden');
  elements.usageFooter.classList.add('hidden');
  elements.errorMessage.textContent = message;
}

/**
 * Show no API key state
 */
function showNoApiKey() {
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.noApiKey.classList.remove('hidden');
  elements.articlePreview.classList.add('hidden');
  elements.usageFooter.classList.add('hidden');
}

/**
 * Show article preview
 * @param {Object} article - Extracted article data
 */
function showArticlePreview(article) {
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.noApiKey.classList.add('hidden');
  elements.articlePreview.classList.remove('hidden');
  elements.usageFooter.classList.remove('hidden');

  elements.articleTitle.textContent = article.title;
  elements.articleAuthor.textContent = article.author || '';
  elements.articleSite.textContent = article.siteName || '';
  elements.wordCount.textContent = article.wordCount.toLocaleString();
  elements.readTime.textContent = article.estimatedReadTime;
}

/**
 * Update progress display
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} text - Progress text
 */
function updateProgress(percent, text) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
}

/**
 * Load usage statistics
 */
async function loadUsageStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getUsage' });

    if (response.success) {
      const { articlesRemaining, limit } = response.usage;
      elements.usageText.textContent = `${articlesRemaining} of ${limit} free articles remaining`;

      // Show upgrade button if usage is high
      if (articlesRemaining <= 3) {
        elements.upgradeBtn.classList.remove('hidden');
      }
    }
  } catch (error) {
    console.error('Failed to load usage stats:', error);
  }
}

/**
 * Check if user can convert
 * @returns {Promise<boolean>}
 */
async function checkCanConvert() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'canConvert' });
    return response.success && response.canConvert;
  } catch (error) {
    console.error('Failed to check conversion limit:', error);
    return false;
  }
}

/**
 * Get settings from background
 * @returns {Promise<Object>}
 */
async function getSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    return response.success ? response.settings : {};
  } catch (error) {
    console.error('Failed to get settings:', error);
    return {};
  }
}

/**
 * Save settings via background
 * @param {Object} settings - Settings to save
 */
async function saveSettings(settings) {
  try {
    await chrome.runtime.sendMessage({ action: 'setSettings', settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// Initialize when popup loads
document.addEventListener('DOMContentLoaded', init);
