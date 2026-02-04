/**
 * Storage module for Article to Podcast extension
 * Handles settings, usage tracking, and conversion history
 */

const STORAGE_KEYS = {
  API_KEY: 'apiKey',
  VOICE: 'voice',
  MODEL: 'model',
  SPEED: 'speed',
  FREE_ARTICLES_USED: 'freeArticlesUsed',
  FREE_ARTICLES_RESET_DATE: 'freeArticlesResetDate',
  HISTORY: 'history'
};

const DEFAULTS = {
  voice: 'nova',
  model: 'tts-1',
  speed: 1.0,
  freeArticlesUsed: 0,
  history: []
};

const FREE_TIER_LIMIT = 10;
const MAX_HISTORY_SIZE = 20;

/**
 * Get all settings from storage
 * @returns {Promise<Object>} Settings object
 */
async function getSettings() {
  const result = await chrome.storage.sync.get([
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.VOICE,
    STORAGE_KEYS.MODEL,
    STORAGE_KEYS.SPEED
  ]);

  return {
    apiKey: result[STORAGE_KEYS.API_KEY] || null,
    voice: result[STORAGE_KEYS.VOICE] || DEFAULTS.voice,
    model: result[STORAGE_KEYS.MODEL] || DEFAULTS.model,
    speed: result[STORAGE_KEYS.SPEED] || DEFAULTS.speed
  };
}

/**
 * Save settings to storage
 * @param {Object} settings - Settings to save
 */
async function setSettings(settings) {
  const toSave = {};

  if (settings.apiKey !== undefined) {
    toSave[STORAGE_KEYS.API_KEY] = settings.apiKey;
  }
  if (settings.voice !== undefined) {
    toSave[STORAGE_KEYS.VOICE] = settings.voice;
  }
  if (settings.model !== undefined) {
    toSave[STORAGE_KEYS.MODEL] = settings.model;
  }
  if (settings.speed !== undefined) {
    toSave[STORAGE_KEYS.SPEED] = settings.speed;
  }

  await chrome.storage.sync.set(toSave);
}

/**
 * Get current usage stats
 * @returns {Promise<Object>} Usage object with articlesUsed and resetDate
 */
async function getUsage() {
  await checkAndResetMonthlyUsage();

  const result = await chrome.storage.sync.get([
    STORAGE_KEYS.FREE_ARTICLES_USED,
    STORAGE_KEYS.FREE_ARTICLES_RESET_DATE
  ]);

  return {
    articlesUsed: result[STORAGE_KEYS.FREE_ARTICLES_USED] || 0,
    articlesRemaining: FREE_TIER_LIMIT - (result[STORAGE_KEYS.FREE_ARTICLES_USED] || 0),
    resetDate: result[STORAGE_KEYS.FREE_ARTICLES_RESET_DATE] || null,
    limit: FREE_TIER_LIMIT
  };
}

/**
 * Increment usage counter after successful conversion
 * @returns {Promise<Object>} Updated usage stats
 */
async function incrementUsage() {
  await checkAndResetMonthlyUsage();

  const result = await chrome.storage.sync.get([STORAGE_KEYS.FREE_ARTICLES_USED]);
  const currentUsage = result[STORAGE_KEYS.FREE_ARTICLES_USED] || 0;
  const newUsage = currentUsage + 1;

  await chrome.storage.sync.set({
    [STORAGE_KEYS.FREE_ARTICLES_USED]: newUsage
  });

  return {
    articlesUsed: newUsage,
    articlesRemaining: FREE_TIER_LIMIT - newUsage,
    limit: FREE_TIER_LIMIT
  };
}

/**
 * Check if user can convert (hasn't exceeded free tier limit)
 * @returns {Promise<boolean>} True if user can convert
 */
async function canConvert() {
  const usage = await getUsage();
  return usage.articlesRemaining > 0;
}

/**
 * Check if it's a new month and reset usage if needed
 */
async function checkAndResetMonthlyUsage() {
  const result = await chrome.storage.sync.get([STORAGE_KEYS.FREE_ARTICLES_RESET_DATE]);
  const resetDate = result[STORAGE_KEYS.FREE_ARTICLES_RESET_DATE];

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (!resetDate || !resetDate.startsWith(currentMonth)) {
    // It's a new month, reset the counter
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    await chrome.storage.sync.set({
      [STORAGE_KEYS.FREE_ARTICLES_USED]: 0,
      [STORAGE_KEYS.FREE_ARTICLES_RESET_DATE]: firstOfMonth
    });
  }
}

/**
 * Get conversion history
 * @returns {Promise<Array>} Array of converted articles
 */
async function getHistory() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.HISTORY]);
  return result[STORAGE_KEYS.HISTORY] || [];
}

/**
 * Add article to conversion history
 * @param {Object} article - Article metadata to add
 */
async function addToHistory(article) {
  const history = await getHistory();

  // Add new article at the beginning
  history.unshift({
    ...article,
    convertedAt: new Date().toISOString()
  });

  // Limit history size
  if (history.length > MAX_HISTORY_SIZE) {
    history.length = MAX_HISTORY_SIZE;
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.HISTORY]: history
  });
}

/**
 * Clear conversion history
 */
async function clearHistory() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.HISTORY]: []
  });
}

// Export for use in other modules
if (typeof globalThis !== 'undefined') {
  globalThis.Storage = {
    getSettings,
    setSettings,
    getUsage,
    incrementUsage,
    canConvert,
    getHistory,
    addToHistory,
    clearHistory,
    DEFAULTS,
    FREE_TIER_LIMIT
  };
}
