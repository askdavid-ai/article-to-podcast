# Article Extraction Spec

## Job to Be Done
Extract clean, readable article content from any webpage, stripping ads, navigation, comments, and other cruft.

## Requirements

### Core Functionality
- Extract article title, author (if available), and main body content
- Handle diverse site structures (news sites, blogs, Medium, Substack, etc.)
- Preserve paragraph structure for natural speech pacing
- Strip: ads, navigation, sidebars, comments, related articles, social widgets

### Technical Approach
- Use Mozilla's Readability.js (battle-tested, same lib as Firefox Reader View)
- Run in content script context (access to page DOM)
- Fallback to basic extraction if Readability fails

### Edge Cases
- Paywalled articles: Extract whatever is visible (don't bypass paywalls)
- Multi-page articles: Handle single page only (v1)
- PDFs: Out of scope for v1
- Non-English: Should work (Readability is language-agnostic)

### Output Format
```typescript
interface ExtractedArticle {
  title: string;
  author?: string;
  siteName?: string;
  content: string;      // Plain text, paragraphs separated by \n\n
  wordCount: number;
  estimatedReadTime: number;  // minutes
  url: string;
}
```

## Success Criteria
- Works on 90%+ of news/blog sites
- Extracts clean content from: NYTimes, Medium, Substack, TechCrunch, personal blogs
- Content is suitable for TTS (no "Click here" or nav remnants)
