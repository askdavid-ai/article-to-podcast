/**
 * Background service worker for Article to Podcast extension
 * Handles TTS API calls via backend, storage, and message coordination
 */

// Import storage module
importScripts('lib/storage.js');

// Constants
const BACKEND_URL = 'https://article-podcast-api.articlepod.workers.dev';
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// Conversion queue for managing concurrent requests
const conversionQueue = new Map();

// Keepalive using alarms to prevent service worker termination during long conversions
const KEEPALIVE_ALARM = 'keepalive';
let isConverting = false;

async function startKeepAlive() {
  isConverting = true;
  await chrome.alarms.create(KEEPALIVE_ALARM, { delayInMinutes: 0.4 });
  console.log('Keepalive started');
}

async function stopKeepAlive() {
  isConverting = false;
  await chrome.alarms.clear(KEEPALIVE_ALARM);
  console.log('Keepalive stopped');
}

// Handle alarm to keep service worker alive
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && isConverting) {
    console.log('Keepalive ping via alarm');
    await chrome.alarms.create(KEEPALIVE_ALARM, { delayInMinutes: 0.4 });
  }
});

/**
 * Get or create user credentials for backend API
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
  const response = await fetch(`${BACKEND_URL}/user/new`);
  if (!response.ok) {
    throw new Error('Failed to create user account');
  }
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
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Article to Podcast extension installed');

  // Set default settings (no API key needed anymore!)
  const settings = await Storage.getSettings();
  if (!settings.voice) {
    await Storage.setSettings({
      voice: Storage.DEFAULTS.voice,
      model: Storage.DEFAULTS.model,
      speed: Storage.DEFAULTS.speed
    });
  }
  
  // Pre-create user account
  try {
    await getOrCreateUserCredentials();
    console.log('User account created');
  } catch (e) {
    console.log('Will create user account on first conversion');
  }
});

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Process incoming messages
 */
async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      case 'getSettings':
        const settings = await Storage.getSettings();
        sendResponse({ success: true, settings });
        break;

      case 'setSettings':
        await Storage.setSettings(message.settings);
        sendResponse({ success: true });
        break;

      case 'getUsage':
        const usage = await Storage.getUsage();
        sendResponse({ success: true, usage });
        break;

      case 'canConvert':
        const canConvert = await Storage.canConvert();
        sendResponse({ success: true, canConvert });
        break;

      case 'convertArticle':
        const tabId = message.tabId || sender.tab?.id;
        if (!tabId) {
          sendResponse({ success: false, error: 'Cannot determine tab ID' });
          break;
        }
        await convertArticle(message.article, tabId);
        sendResponse({ success: true });
        break;

      case 'downloadAudio':
        await downloadAudio(message.url, message.filename);
        sendResponse({ success: true });
        break;

      case 'getHistory':
        const history = await Storage.getHistory();
        sendResponse({ success: true, history });
        break;
        
      case 'getUserCredentials':
        const credentials = await getOrCreateUserCredentials();
        sendResponse({ success: true, credentials });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Message handling error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Convert article text to audio via backend
 * @param {Object} article - Article data from content script
 * @param {number} tabId - Tab ID for sending status updates
 */
async function convertArticle(article, tabId) {
  try {
    // Check usage limits (local tracking)
    const canConvert = await Storage.canConvert();
    if (!canConvert) {
      updatePlayerStatus(tabId, 'error', 'Monthly limit reached. Upgrade for unlimited conversions.');
      return;
    }

    // Get settings
    const settings = await Storage.getSettings();

    // Start keepalive to prevent service worker termination
    startKeepAlive();

    // Show player with loading state
    await chrome.tabs.sendMessage(tabId, {
      action: 'showPlayer',
      options: { title: article.title }
    });

    updatePlayerStatus(tabId, 'loading', 'Preparing conversion...');

    // Get or create user credentials
    let credentials;
    try {
      credentials = await getOrCreateUserCredentials();
    } catch (e) {
      updatePlayerStatus(tabId, 'error', 'Failed to initialize. Please check your internet connection.');
      stopKeepAlive();
      return;
    }

    updatePlayerStatus(tabId, 'loading', 'Converting to audio...');

    console.log(`Converting article: ${article.title}`);

    // Call backend TTS endpoint
    const response = await fetch(`${BACKEND_URL}/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: credentials.userId,
        userSecret: credentials.userSecret,
        text: article.content,
        voice: settings.voice || 'nova',
        model: settings.model || 'tts-1',
        title: article.title
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 429) {
        throw new Error(errorData.error || 'Daily conversion limit reached. Try again tomorrow.');
      } else if (response.status === 503) {
        throw new Error('Service temporarily unavailable. Please try again.');
      } else {
        throw new Error(errorData.error || 'Conversion failed. Please try again.');
      }
    }

    // Get audio data
    const audioData = await response.arrayBuffer();
    
    // Convert to base64 to send to content script
    const base64Audio = arrayBufferToBase64(audioData);

    // Increment local usage counter
    await Storage.incrementUsage();

    // Add to history
    await Storage.addToHistory({
      title: article.title,
      url: article.url,
      author: article.author,
      siteName: article.siteName,
      wordCount: article.wordCount
    });

    // Update player with audio
    updatePlayerStatus(tabId, 'ready', null, null, base64Audio, article.title);

    stopKeepAlive();
    console.log('Article converted successfully');
    
  } catch (error) {
    stopKeepAlive();
    console.error('Conversion error:', error);
    updatePlayerStatus(tabId, 'error', error.message || 'Conversion failed. Please try again.');
  }
}

/**
 * Send status update to content script player
 */
async function updatePlayerStatus(tabId, status, text, audioUrl = null, audioBase64 = null, title = null) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'updatePlayerStatus',
      status,
      text,
      audioUrl,
      audioBase64,
      title,
      error: status === 'error' ? text : null
    });
  } catch (error) {
    console.error('Failed to update player status:', error);
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Handle audio download
 */
async function downloadAudio(url, filename) {
  try {
    let sanitizedFilename = (filename || 'article')
      .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 100);

    if (!sanitizedFilename || sanitizedFilename === '') {
      sanitizedFilename = 'article';
    }

    sanitizedFilename += '.mp3';

    await chrome.downloads.download({
      url: url,
      filename: sanitizedFilename,
      saveAs: true
    });
  } catch (error) {
    console.error('Download error:', error);
  }
}

chrome.runtime.onStartup.addListener(() => {
  console.log('Article to Podcast service worker started');
});

console.log('Article to Podcast: Background service worker loaded');
