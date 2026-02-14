# Article to Podcast - Backend API

Cloudflare Workers + R2 backend for podcast feed generation.

## Quick Deploy (5 minutes)

### Step 1: Install Wrangler CLI
```bash
npm install -g wrangler
```

### Step 2: Login to Cloudflare
```bash
cd ~/.openclaw/workspace/systems/article-to-podcast/backend
wrangler login
```
This opens a browser to authenticate.

### Step 3: Create R2 Bucket
```bash
wrangler r2 bucket create article-podcast-audio
```

### Step 4: Create KV Namespace
```bash
wrangler kv:namespace create FEEDS
```
This outputs something like:
```
{ binding = "FEEDS", id = "abc123xyz789" }
```
**Copy that `id` value.**

### Step 5: Update wrangler.toml
Edit `wrangler.toml` and replace `REPLACE_WITH_YOUR_KV_ID` with your actual KV id.

### Step 6: Deploy
```bash
wrangler deploy
```

You'll get a URL like:
```
https://article-podcast-api.YOUR_SUBDOMAIN.workers.dev
```

**That's your API! Save this URL.**

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/user/new` | Create new user + feed |
| POST | `/upload` | Upload audio episode |
| GET | `/feed/:userId` | RSS podcast feed |
| GET | `/audio/:userId/:episodeId` | Stream audio |
| DELETE | `/episode/:userId/:episodeId` | Delete episode |
| GET | `/health` | Health check |

### Create User
```bash
curl https://YOUR_API_URL/user/new
```
Returns:
```json
{
  "userId": "abc12345",
  "userSecret": "xxxxxxxxxxxxxxxxxxxxxxxx",
  "feedUrl": "https://YOUR_API_URL/feed/abc12345"
}
```
**Important:** Store `userSecret` - it's required for uploads and deletions.

### Upload Audio
```bash
curl -X POST https://YOUR_API_URL/upload \
  -F "audio=@article.mp3" \
  -F "userId=abc12345" \
  -F "userSecret=xxxxxxxxxxxxxxxxxxxxxxxx" \
  -F "title=My Article Title" \
  -F "author=Author Name" \
  -F "sourceUrl=https://example.com/article" \
  -F "duration=180"
```

### Delete Episode
```bash
curl -X DELETE https://YOUR_API_URL/episode/abc12345/episodeid123 \
  -H "X-User-Secret: xxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Costs (Free Tier Covers Most Usage)

| Resource | Free Tier | Paid |
|----------|-----------|------|
| Workers | 100k requests/day | $0.50/million |
| R2 Storage | 10 GB | $0.015/GB/month |
| KV Reads | 100k/day | $0.50/million |
| KV Writes | 1k/day | $5.00/million |

**Realistic cost for small app:** $0-5/month

---

## Security Features

- **User secrets** - Required for mutations (upload/delete)
- **Input validation** - IDs validated, lengths limited
- **File size limit** - 50MB max per upload
- **Episode limit** - 100 episodes per feed (oldest auto-deleted)
- **Range requests** - Supports seeking in podcast apps

---

## Local Development

```bash
wrangler dev
```
Starts local server at `http://localhost:8787`

Note: R2 and KV won't work locally without `--remote` flag:
```bash
wrangler dev --remote
```
