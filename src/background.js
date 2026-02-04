/**
 * Background service worker for Article to Podcast extension
 * Handles TTS API calls, storage, and message coordination
 */

// Import storage module
importScripts('lib/storage.js');

// Constants
const TTS_API_URL = 'https://api.openai.com/v1/audio/speech';
const MAX_CHUNK_SIZE = 4000; // Leave buffer below 4096 limit
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// Conversion queue for managing concurrent requests
const conversionQueue = new Map();

/**
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Article to Podcast extension installed');

  // Set default settings
  const settings = await Storage.getSettings();
  if (!settings.voice) {
    await Storage.setSettings({
      voice: Storage.DEFAULTS.voice,
      model: Storage.DEFAULTS.model,
      speed: Storage.DEFAULTS.speed
    });
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
        await convertArticle(message.article, sender.tab?.id);
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

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Message handling error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Convert article text to audio
 * @param {Object} article - Article data from content script
 * @param {number} tabId - Tab ID for sending status updates
 */
async function convertArticle(article, tabId) {
  try {
    // Check usage limits
    const canConvert = await Storage.canConvert();
    if (!canConvert) {
      updatePlayerStatus(tabId, 'error', 'Monthly limit reached. Upgrade for unlimited conversions.');
      return;
    }

    // Get settings
    const settings = await Storage.getSettings();

    if (!settings.apiKey) {
      updatePlayerStatus(tabId, 'error', 'Please set your OpenAI API key in the extension settings.');
      return;
    }

    // Show player with loading state
    await chrome.tabs.sendMessage(tabId, {
      action: 'showPlayer',
      options: { title: article.title }
    });

    updatePlayerStatus(tabId, 'loading', 'Extracting article...');

    // Chunk the text
    const chunks = chunkText(article.content);
    const totalChunks = chunks.length;

    console.log(`Converting article: ${article.title} (${totalChunks} chunks)`);

    // Convert each chunk
    const audioChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      updatePlayerStatus(tabId, 'loading', `Converting to audio (${i + 1}/${totalChunks})...`);

      const audioData = await callTTSApi(chunks[i], settings);
      audioChunks.push(audioData);
    }

    // Stitch audio chunks
    updatePlayerStatus(tabId, 'loading', 'Preparing audio...');
    const finalAudio = await stitchAudioChunks(audioChunks);

    // Create blob URL
    const blob = new Blob([finalAudio], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(blob);

    // Store in cache for download
    conversionQueue.set(article.url, {
      audioUrl,
      blob,
      title: article.title,
      author: article.author
    });

    // Increment usage
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
    updatePlayerStatus(tabId, 'ready', null, audioUrl);

    console.log('Article converted successfully');
  } catch (error) {
    console.error('Conversion error:', error);
    updatePlayerStatus(tabId, 'error', error.message || 'Conversion failed. Please try again.');
  }
}

/**
 * Split text into chunks respecting API limits and sentence boundaries
 * @param {string} text - Full article text
 * @returns {string[]} Array of text chunks
 */
function chunkText(text) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If paragraph itself is too long, split by sentences
    if (paragraph.length > MAX_CHUNK_SIZE) {
      // Flush current chunk first
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split paragraph by sentences
      const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > MAX_CHUNK_SIZE) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = sentence;
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      }
    } else if (currentChunk.length + paragraph.length + 2 > MAX_CHUNK_SIZE) {
      // Current chunk is full, start new one
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      // Add paragraph to current chunk
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Call OpenAI TTS API
 * @param {string} text - Text to convert
 * @param {Object} settings - User settings
 * @returns {ArrayBuffer} Audio data
 */
async function callTTSApi(text, settings) {
  const response = await fetch(TTS_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model || 'tts-1',
      input: text,
      voice: settings.voice || 'nova',
      response_format: 'mp3'
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));

    if (response.status === 401) {
      throw new Error('Invalid API key. Please check your OpenAI API key in settings.');
    } else if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    } else if (response.status === 400) {
      throw new Error(errorData.error?.message || 'Invalid request to TTS API.');
    } else {
      throw new Error(`TTS API error: ${response.status}`);
    }
  }

  return await response.arrayBuffer();
}

/**
 * Stitch multiple audio chunks into a single file
 * @param {ArrayBuffer[]} chunks - Array of audio data
 * @returns {ArrayBuffer} Combined audio
 */
async function stitchAudioChunks(chunks) {
  if (chunks.length === 1) {
    return chunks[0];
  }

  // For MP3, we can simply concatenate the chunks
  // This works because each chunk is a valid MP3 file
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return combined.buffer;
}

/**
 * Send status update to content script player
 * @param {number} tabId - Tab ID
 * @param {string} status - Status type (loading, ready, error)
 * @param {string} text - Status text or error message
 * @param {string} audioUrl - Audio URL (for ready status)
 */
async function updatePlayerStatus(tabId, status, text, audioUrl = null) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'updatePlayerStatus',
      status,
      text,
      audioUrl,
      error: status === 'error' ? text : null
    });
  } catch (error) {
    console.error('Failed to update player status:', error);
  }
}

/**
 * Handle audio download
 * @param {string} url - Blob URL of audio
 * @param {string} filename - Desired filename
 */
async function downloadAudio(url, filename) {
  try {
    // Sanitize filename
    const sanitizedFilename = filename
      .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 100) + '.mp3';

    await chrome.downloads.download({
      url: url,
      filename: sanitizedFilename,
      saveAs: true
    });
  } catch (error) {
    console.error('Download error:', error);
  }
}

// Keep service worker alive during long conversions
chrome.runtime.onStartup.addListener(() => {
  console.log('Article to Podcast service worker started');
});

console.log('Article to Podcast: Background service worker loaded');
