# Monetization Spec

## Job to Be Done
Sustainable business model that balances user acquisition with revenue.

## Pricing Strategy

### Free Tier
- 10 articles/month (double competitors)
- All voices available
- In-browser player
- MP3 download

### Pro Tier ($3/month or $25/year)
- Unlimited articles
- Priority conversion (faster)
- Personal podcast feed (v2)
- Usage analytics
- No branding on downloads

### Why $3/month
- Undercuts all competitors:
  - ArticleAudio: $5/mo
  - ArticleCast: $10/mo  
  - Speechify: $139/yr (~$12/mo)
- API cost per article: ~$0.05-0.10
- At $3/mo, need ~30-60 articles to break even
- Most users won't hit that → healthy margins

## Technical Implementation

### Free Tier Tracking
```typescript
interface UsageTracking {
  articlesThisMonth: number;
  monthStartDate: string;  // Reset monthly
  totalArticlesEver: number;
}
```

### Payment Integration (v2)
- Stripe for subscriptions
- Store subscription status in extension storage
- Validate via simple API call to backend
- Grace period: 3 days after failed payment

### MVP (No Payment)
For weekend build:
- Free tier only (10 articles)
- "Upgrade" button links to waitlist
- Collect emails for launch

## Usage Limits Enforcement
- Check `articlesThisMonth` before conversion
- If limit reached, show upgrade prompt
- Reset count on 1st of each month
- Store in chrome.storage.sync (syncs across devices)

## Success Criteria
- Clear value prop for upgrade
- Frictionless free experience (no credit card required)
- Easy upgrade path when ready
