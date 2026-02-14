/**
 * Article to Podcast - Backend API
 * 
 * Cloudflare Workers + R2 storage for podcast feed generation
 * 
 * Endpoints:
 * - POST /convert               - Convert text to audio (TTS) ⭐ NEW
 * - GET  /user/new              - Create new user/feed
 * - POST /upload                - Upload audio for user's feed
 * - GET  /feed/:userId          - Get RSS podcast feed
 * - GET  /audio/:userId/:epId   - Stream audio file (supports Range requests)
 * - DELETE /episode/:userId/:epId - Delete an episode
 * - GET  /health                - Health check
 */

// Defaults - can be customized per user later
const DEFAULT_PODCAST_TITLE = "My Article Podcast";
const DEFAULT_PODCAST_DESCRIPTION = "Articles converted to audio with Article to Podcast";
const DEFAULT_PODCAST_AUTHOR = "Article to Podcast";

// Limits
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
const MAX_EPISODES_PER_FEED = 100;
const MAX_TEXT_LENGTH = 100000; // ~100k chars max per conversion
const MAX_CHUNK_SIZE = 4000; // OpenAI TTS limit per request
const RATE_LIMIT_CONVERSIONS = 50; // Max conversions per user per day

// OpenAI TTS settings
const TTS_MODEL = 'tts-1';
const TTS_VOICE = 'nova';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const baseUrl = url.origin;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-User-Secret',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok', timestamp: Date.now() }, corsHeaders);
      }

      // TTS Conversion (new!)
      if (path === '/convert' && request.method === 'POST') {
        return handleConvert(request, env, corsHeaders);
      }

      // Create new user
      if (path === '/user/new' && request.method === 'GET') {
        return handleNewUser(env, baseUrl, corsHeaders);
      }

      // Upload audio
      if (path === '/upload' && request.method === 'POST') {
        return handleUpload(request, env, baseUrl, corsHeaders);
      }

      // Get RSS feed
      if (path.match(/^\/feed\/[a-z0-9]+$/)) {
        const userId = path.split('/')[2];
        return handleFeed(userId, env, baseUrl);
      }

      // Stream audio (supports Range requests)
      if (path.match(/^\/audio\/[a-z0-9]+\/[a-z0-9]+$/)) {
        const parts = path.split('/');
        return handleAudio(parts[2], parts[3], request, env);
      }

      // Delete episode
      if (path.match(/^\/episode\/[a-z0-9]+\/[a-z0-9]+$/) && request.method === 'DELETE') {
        const parts = path.split('/');
        return handleDeleteEpisode(parts[2], parts[3], request, env, corsHeaders);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
};

/**
 * Helper: JSON response
 */
function jsonResponse(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

/**
 * Helper: Validate ID format (alphanumeric only)
 */
function isValidId(id, length) {
  if (!id || typeof id !== 'string') return false;
  if (id.length !== length) return false;
  return /^[a-z0-9]+$/.test(id);
}

/**
 * Generate cryptographically secure ID
 */
function generateId(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => chars[byte % chars.length]).join('');
}

/**
 * Split text into chunks for TTS (respects sentence boundaries)
 */
function chunkText(text, maxLength = MAX_CHUNK_SIZE) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (sentence end)
    let breakPoint = maxLength;
    const sentenceEnd = remaining.lastIndexOf('. ', maxLength);
    const questionEnd = remaining.lastIndexOf('? ', maxLength);
    const exclamEnd = remaining.lastIndexOf('! ', maxLength);
    
    const bestEnd = Math.max(sentenceEnd, questionEnd, exclamEnd);
    if (bestEnd > maxLength * 0.5) {
      breakPoint = bestEnd + 1;
    } else {
      // Fall back to word boundary
      const spacePos = remaining.lastIndexOf(' ', maxLength);
      if (spacePos > maxLength * 0.5) {
        breakPoint = spacePos;
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

/**
 * Check and update rate limit for user
 */
async function checkRateLimit(userId, env) {
  const today = new Date().toISOString().split('T')[0];
  const key = `ratelimit:${userId}:${today}`;
  
  const current = await env.FEEDS.get(key);
  const count = current ? parseInt(current) : 0;
  
  if (count >= RATE_LIMIT_CONVERSIONS) {
    return { allowed: false, remaining: 0 };
  }
  
  // Increment counter (expires after 24h)
  await env.FEEDS.put(key, (count + 1).toString(), { expirationTtl: 86400 });
  
  return { allowed: true, remaining: RATE_LIMIT_CONVERSIONS - count - 1 };
}

/**
 * Handle TTS conversion
 * POST /convert
 * Body: { userId, userSecret, text, voice?, model? }
 * Returns: audio/mpeg stream
 */
async function handleConvert(request, env, corsHeaders) {
  // Check for OpenAI API key
  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: 'TTS service not configured' }, corsHeaders, 503);
  }

  const body = await request.json();
  const { userId, userSecret, text, voice, model, title } = body;

  // Validate required fields
  if (!userId || !userSecret || !text) {
    return jsonResponse({ error: 'Missing required fields: userId, userSecret, text' }, corsHeaders, 400);
  }

  if (!isValidId(userId, 8)) {
    return jsonResponse({ error: 'Invalid userId format' }, corsHeaders, 400);
  }

  // Verify user credentials
  const feedData = await env.FEEDS.get(`feed:${userId}`, 'json');
  if (!feedData) {
    return jsonResponse({ error: 'User not found' }, corsHeaders, 404);
  }
  if (feedData.userSecret !== userSecret) {
    return jsonResponse({ error: 'Invalid userSecret' }, corsHeaders, 403);
  }

  // Check rate limit
  const rateLimit = await checkRateLimit(userId, env);
  if (!rateLimit.allowed) {
    return jsonResponse({ 
      error: 'Daily conversion limit reached. Try again tomorrow.',
      limit: RATE_LIMIT_CONVERSIONS
    }, corsHeaders, 429);
  }

  // Validate text length
  if (text.length > MAX_TEXT_LENGTH) {
    return jsonResponse({ 
      error: `Text too long. Maximum ${MAX_TEXT_LENGTH} characters.`,
      length: text.length 
    }, corsHeaders, 400);
  }

  // Split text into chunks
  const chunks = chunkText(text);
  const totalChunks = chunks.length;
  
  // Convert each chunk to audio
  const audioChunks = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || TTS_MODEL,
          voice: voice || TTS_VOICE,
          input: chunk,
          response_format: 'mp3'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('OpenAI TTS error:', error);
        return jsonResponse({ 
          error: 'TTS conversion failed',
          details: response.status === 429 ? 'Rate limited by OpenAI' : 'API error'
        }, corsHeaders, 502);
      }

      const audioData = await response.arrayBuffer();
      audioChunks.push(new Uint8Array(audioData));
      
    } catch (error) {
      console.error('TTS chunk error:', error);
      return jsonResponse({ error: 'TTS conversion failed' }, corsHeaders, 502);
    }
  }

  // Concatenate all audio chunks
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combinedAudio = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of audioChunks) {
    combinedAudio.set(chunk, offset);
    offset += chunk.length;
  }

  // Return audio with metadata headers
  return new Response(combinedAudio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': combinedAudio.length.toString(),
      'X-Chunks-Processed': totalChunks.toString(),
      'X-Rate-Limit-Remaining': rateLimit.remaining.toString(),
      ...corsHeaders
    }
  });
}

/**
 * Create a new user/feed
 */
async function handleNewUser(env, baseUrl, corsHeaders) {
  const userId = generateId(8);
  const userSecret = generateId(24); // Secret for mutations
  
  const feedData = {
    userId,
    userSecret, // Stored but never exposed in feed
    createdAt: Date.now(),
    settings: {
      title: DEFAULT_PODCAST_TITLE,
      description: DEFAULT_PODCAST_DESCRIPTION,
      author: DEFAULT_PODCAST_AUTHOR,
      artwork: null
    },
    episodes: []
  };
  
  await env.FEEDS.put(`feed:${userId}`, JSON.stringify(feedData));
  
  return jsonResponse({
    userId,
    userSecret, // Client must store this for uploads/deletions
    feedUrl: `${baseUrl}/feed/${userId}`,
    message: 'Add the feedUrl to your podcast app. Keep userSecret safe for uploading.'
  }, corsHeaders);
}

/**
 * Handle audio upload
 */
async function handleUpload(request, env, baseUrl, corsHeaders) {
  // Check content length before processing
  const contentLength = parseInt(request.headers.get('content-length') || '0');
  if (contentLength > MAX_FILE_SIZE) {
    return jsonResponse({ error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB` }, corsHeaders, 413);
  }

  const formData = await request.formData();
  const audioFile = formData.get('audio');
  const userId = formData.get('userId');
  const userSecret = formData.get('userSecret');
  const title = formData.get('title') || 'Untitled Article';
  const author = formData.get('author') || '';
  const sourceUrl = formData.get('sourceUrl') || '';
  const duration = parseInt(formData.get('duration')) || 0;
  const description = formData.get('description') || '';

  // Validate required fields
  if (!audioFile) {
    return jsonResponse({ error: 'Missing audio file' }, corsHeaders, 400);
  }
  if (!isValidId(userId, 8)) {
    return jsonResponse({ error: 'Invalid userId format' }, corsHeaders, 400);
  }
  if (!userSecret) {
    return jsonResponse({ error: 'Missing userSecret' }, corsHeaders, 400);
  }

  // Verify user exists and secret matches
  const feedKey = `feed:${userId}`;
  let feedData = await env.FEEDS.get(feedKey, 'json');
  
  if (!feedData) {
    return jsonResponse({ error: 'User not found' }, corsHeaders, 404);
  }
  if (feedData.userSecret !== userSecret) {
    return jsonResponse({ error: 'Invalid userSecret' }, corsHeaders, 403);
  }

  // Read audio into buffer ONCE (fixes double-consume bug)
  const audioBuffer = await audioFile.arrayBuffer();
  const fileSize = audioBuffer.byteLength;

  // Check file size again (in case content-length header was wrong)
  if (fileSize > MAX_FILE_SIZE) {
    return jsonResponse({ error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB` }, corsHeaders, 413);
  }

  // Generate episode ID
  const episodeId = generateId(12);
  
  // Upload audio to R2 from buffer
  const audioKey = `${userId}/${episodeId}.mp3`;
  await env.AUDIO_BUCKET.put(audioKey, audioBuffer, {
    httpMetadata: { contentType: 'audio/mpeg' }
  });

  // Add episode to feed
  const episode = {
    id: episodeId,
    title: title.slice(0, 500), // Limit title length
    author: author.slice(0, 200),
    description: description.slice(0, 2000),
    sourceUrl: sourceUrl.slice(0, 2000),
    duration,
    fileSize,
    publishedAt: Date.now()
  };

  feedData.episodes.unshift(episode);
  
  // Keep only last N episodes
  if (feedData.episodes.length > MAX_EPISODES_PER_FEED) {
    const removed = feedData.episodes.splice(MAX_EPISODES_PER_FEED);
    // Clean up old audio files
    for (const ep of removed) {
      await env.AUDIO_BUCKET.delete(`${userId}/${ep.id}.mp3`);
    }
  }

  await env.FEEDS.put(feedKey, JSON.stringify(feedData));

  return jsonResponse({
    success: true,
    episodeId,
    episodeUrl: `${baseUrl}/audio/${userId}/${episodeId}`,
    feedUrl: `${baseUrl}/feed/${userId}`
  }, corsHeaders);
}

/**
 * Delete an episode
 */
async function handleDeleteEpisode(userId, episodeId, request, env, corsHeaders) {
  const userSecret = request.headers.get('X-User-Secret');
  
  if (!isValidId(userId, 8) || !isValidId(episodeId, 12)) {
    return jsonResponse({ error: 'Invalid ID format' }, corsHeaders, 400);
  }
  if (!userSecret) {
    return jsonResponse({ error: 'Missing X-User-Secret header' }, corsHeaders, 400);
  }

  const feedKey = `feed:${userId}`;
  const feedData = await env.FEEDS.get(feedKey, 'json');
  
  if (!feedData) {
    return jsonResponse({ error: 'User not found' }, corsHeaders, 404);
  }
  if (feedData.userSecret !== userSecret) {
    return jsonResponse({ error: 'Invalid userSecret' }, corsHeaders, 403);
  }

  // Find and remove episode
  const episodeIndex = feedData.episodes.findIndex(ep => ep.id === episodeId);
  if (episodeIndex === -1) {
    return jsonResponse({ error: 'Episode not found' }, corsHeaders, 404);
  }

  feedData.episodes.splice(episodeIndex, 1);
  await env.FEEDS.put(feedKey, JSON.stringify(feedData));

  // Delete audio file
  await env.AUDIO_BUCKET.delete(`${userId}/${episodeId}.mp3`);

  return jsonResponse({ success: true, message: 'Episode deleted' }, corsHeaders);
}

/**
 * Generate RSS podcast feed
 */
async function handleFeed(userId, env, baseUrl) {
  if (!isValidId(userId, 8)) {
    return new Response('Invalid user ID', { status: 400 });
  }

  const feedData = await env.FEEDS.get(`feed:${userId}`, 'json');
  
  if (!feedData) {
    return new Response('Feed not found', { status: 404 });
  }

  const rss = generateRSS(feedData, baseUrl);
  
  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

/**
 * Stream audio file from R2 with Range request support
 */
async function handleAudio(userId, episodeId, request, env) {
  if (!isValidId(userId, 8) || !isValidId(episodeId, 12)) {
    return new Response('Invalid ID format', { status: 400 });
  }

  const audioKey = `${userId}/${episodeId}.mp3`;
  const rangeHeader = request.headers.get('Range');

  // Handle Range requests for seeking
  if (rangeHeader) {
    const object = await env.AUDIO_BUCKET.get(audioKey);
    if (!object) {
      return new Response('Audio not found', { status: 404 });
    }

    const size = object.size;
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    
    if (match) {
      const start = parseInt(match[1]);
      const end = match[2] ? parseInt(match[2]) : size - 1;
      
      // Get the range from R2
      const rangeObject = await env.AUDIO_BUCKET.get(audioKey, {
        range: { offset: start, length: end - start + 1 }
      });

      if (!rangeObject) {
        return new Response('Audio not found', { status: 404 });
      }

      return new Response(rangeObject.body, {
        status: 206,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': (end - start + 1).toString(),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    }
  }

  // Full file request
  const object = await env.AUDIO_BUCKET.get(audioKey);
  if (!object) {
    return new Response('Audio not found', { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': object.size.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000'
    }
  });
}

/**
 * Generate RSS XML for podcast feed
 */
function generateRSS(feedData, baseUrl) {
  const escapeXml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const formatDuration = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toUTCString();
  };

  const settings = feedData.settings || {};
  const title = settings.title || DEFAULT_PODCAST_TITLE;
  const description = settings.description || DEFAULT_PODCAST_DESCRIPTION;
  const author = settings.author || DEFAULT_PODCAST_AUTHOR;
  const artwork = settings.artwork || `${baseUrl}/artwork.png`;

  const episodes = feedData.episodes.map(ep => `
    <item>
      <title>${escapeXml(ep.title)}</title>
      <description><![CDATA[${ep.description || (ep.author ? `By ${ep.author}` : 'Converted article')}${ep.sourceUrl ? `\n\nSource: ${ep.sourceUrl}` : ''}]]></description>
      <pubDate>${formatDate(ep.publishedAt)}</pubDate>
      <enclosure url="${baseUrl}/audio/${feedData.userId}/${ep.id}" type="audio/mpeg" length="${ep.fileSize || 0}"/>
      <guid isPermaLink="false">${feedData.userId}-${ep.id}</guid>
      <itunes:duration>${formatDuration(ep.duration)}</itunes:duration>
      <itunes:author>${escapeXml(ep.author || author)}</itunes:author>
      <itunes:summary>${escapeXml(ep.description || ep.title)}</itunes:summary>
      ${ep.sourceUrl ? `<link>${escapeXml(ep.sourceUrl)}</link>` : ''}
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(description)}</description>
    <language>en-us</language>
    <itunes:author>${escapeXml(author)}</itunes:author>
    <itunes:owner>
      <itunes:email>noreply@articlepod.app</itunes:email>
    </itunes:owner>
    <itunes:image href="${artwork}"/>
    <itunes:category text="Education"/>
    <itunes:explicit>false</itunes:explicit>
    <link>${baseUrl}/feed/${feedData.userId}</link>
    <atom:link href="${baseUrl}/feed/${feedData.userId}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${formatDate(Date.now())}</lastBuildDate>
    ${episodes}
  </channel>
</rss>`;
}
