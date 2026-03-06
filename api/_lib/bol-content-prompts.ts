/**
 * AI Prompt Engineering for Bol.com Content Optimization
 * Claude Sonnet 4.5 optimized prompts
 */

import type {
  BolProduct,
  BolProductKeywordTarget,
  BolCategoryAttributeRequirements,
  BolCompetitorCatalog,
} from '../../src/types/bol.js';

export interface ContentGenerationContext {
  product: {
    ean: string;
    title: string | null;
    description: string | null;
    category: string | null;
    price: number | null;
    catalogAttributes: Record<string, any> | null;
  };
  keywords: BolProductKeywordTarget[];
  categoryRequirements: BolCategoryAttributeRequirements | null;
  clientBrief: string | null;
  competitor: BolCompetitorCatalog | null;
  currentCompleteness: {
    overall_score: number | null;
    required_filled: number;
    required_total: number;
    title_length: number;
    description_length: number;
  } | null;
}

export function buildContentOptimizationPrompt(context: ContentGenerationContext): string {
  const { product, keywords, categoryRequirements, clientBrief, competitor, currentCompleteness } = context;

  // Extract high-priority keywords (priority >= 7)
  const highPriorityKeywords = keywords
    .filter(kw => kw.priority >= 7)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  // Extract keywords NOT in current title
  const missingKeywords = keywords
    .filter(kw => !kw.in_title && kw.search_volume && kw.search_volume > 100)
    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    .slice(0, 5);

  // Build required attributes list
  const requiredAttrs = categoryRequirements?.required_attributes || [];
  const filledAttrs = requiredAttrs.filter(attr => {
    const val = product.catalogAttributes?.[attr];
    return val && val !== '';
  });

  return `Je bent een expert Bol.com content optimizer gespecialiseerd in Nederlandse e-commerce SEO.

## HUIDIGE PRODUCT

**EAN:** ${product.ean}
**Categorie:** ${product.category || 'Onbekend'}
**Huidige titel:** ${product.title || '(geen titel)'}
**Huidige description:** ${product.description ? `${product.description.substring(0, 200)}...` : '(geen description)'}
**Prijs:** €${product.price?.toFixed(2) || '0.00'}

**Completeness Score:** ${currentCompleteness?.overall_score || 0}% (${currentCompleteness?.required_filled || 0}/${currentCompleteness?.required_total || 0} vereiste attributen ingevuld)

${filledAttrs.length > 0 ? `**Ingevulde attributen:** ${filledAttrs.join(', ')}` : ''}

## TARGET KEYWORDS (hoogste prioriteit)

${highPriorityKeywords.map(kw =>
  `- **${kw.keyword}** (${kw.search_volume?.toLocaleString() || '?'} zoekvolume/maand, prioriteit: ${kw.priority}/10)${kw.in_title ? ' ✓ AL IN TITEL' : ' ✗ NIET IN TITEL'}`
).join('\n')}

${missingKeywords.length > 0 ? `\n**BELANGRIJKSTE ONTBREKENDE KEYWORDS:**\n${missingKeywords.map(kw =>
  `- ${kw.keyword} (${kw.search_volume?.toLocaleString()} zoekvolume/maand)`
).join('\n')}` : ''}

## CATEGORIE VEREISTEN

${categoryRequirements ? `
**Categorie:** ${categoryRequirements.category_name}
**Vereiste attributen:** ${requiredAttrs.join(', ')}
**Titel lengte:** Min ${categoryRequirements.title_min_length}, Max ${categoryRequirements.title_max_length} karakters
**Description lengte:** Min ${categoryRequirements.description_min_length} karakters
` : 'Geen specifieke vereisten voor deze categorie.'}

${competitor ? `
## CONCURRENT ANALYSE

**Concurrent titel:** ${competitor.title}
**Concurrent description:** ${competitor.description?.substring(0, 150)}...
**Concurrent prijs:** €${competitor.list_price?.toFixed(2) || '?'}

**LET OP:** De concurrent scoort mogelijk hoger. Analyseer hun keyword gebruik en structuur.
` : ''}

${clientBrief ? `
## KLANT BRIEFING (Tone of Voice)

${clientBrief}

**BELANGRIJK:** Houd deze tone of voice aan in alle content!
` : ''}

## TAAK

Genereer een **geoptimaliseerde titel en description** voor dit product volgens Bol.com best practices.

### RICHTLIJNEN

**Titel:**
- Integreer de top 3-5 hoogste prioriteit keywords (vooral die NIET in huidige titel staan)
- Begin met het belangrijkste keyword (hoogste zoekvolume)
- Voeg merk toe als beschikbaar
- Vermeld kleur/maat/materiaal als relevant
- GEEN emoji, GEEN ALL CAPS, GEEN vage termen ("premium", "super", etc.)
- Blijf binnen ${categoryRequirements?.title_max_length || 150} karakters
- Zorg voor natuurlijke leesbaarheid (geen keyword stuffing)

**Description:**
1. **Intro (1-2 zinnen):** Korte productomschrijving met belangrijkste USPs
2. **USPs (3-5 bullet points):** Concrete voordelen en features
3. **Details (langere tekst):** Specificaties, materialen, gebruik, onderhoud

**Structuur:**
- Gebruik HTML tags: <p>, <ul>, <li>, <strong>
- Integreer keywords naturlijk (geen herhaling)
- Focus op klantvoordelen, niet alleen features
- Minimaal ${categoryRequirements?.description_min_length || 200} karakters totaal

### OUTPUT FORMAT

Geef je antwoord EXACT in dit JSON formaat (geen extra tekst):

\`\`\`json
{
  "title": "Geoptimaliseerde titel hier (max ${categoryRequirements?.title_max_length || 150} chars)",
  "description": "Volledige HTML description hier met <p>, <ul>, <li> tags",
  "description_parts": {
    "intro": "Intro tekst (1-2 zinnen)",
    "usps": [
      "USP 1: Concrete voordeel",
      "USP 2: Feature met voordeel",
      "USP 3: Uniek verkoopargument"
    ],
    "details": "Langere tekst met specificaties en gebruik"
  },
  "keywords_used": ["keyword1", "keyword2", "keyword3"],
  "reasoning": "Korte uitleg (1-2 zinnen) waarom deze optimalisaties effectief zijn"
}
\`\`\`

**KRITISCH:**
- Geen emoji of speciale tekens
- Nederlandse taal, correcte grammatica
- SEO-vriendelijk maar natuurlijk leesbaar
- Focus op conversie, niet alleen rankings`;
}

export function parseClaudeResponse(rawResponse: string): {
  title: string;
  description: string;
  description_parts: {
    intro: string;
    usps: string[];
    details: string;
  };
  keywords_used: string[];
  reasoning: string;
} | null {
  try {
    // Extract JSON from markdown code block if present
    const jsonMatch = rawResponse.match(/```json\s*\n([\s\S]*?)\n```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : rawResponse;

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.title || !parsed.description || !parsed.description_parts) {
      throw new Error('Missing required fields in Claude response');
    }

    return {
      title: parsed.title.trim(),
      description: parsed.description.trim(),
      description_parts: {
        intro: parsed.description_parts.intro?.trim() || '',
        usps: Array.isArray(parsed.description_parts.usps) ? parsed.description_parts.usps : [],
        details: parsed.description_parts.details?.trim() || '',
      },
      keywords_used: Array.isArray(parsed.keywords_used) ? parsed.keywords_used : [],
      reasoning: parsed.reasoning?.trim() || '',
    };
  } catch (err) {
    console.error('Failed to parse Claude response:', err);
    console.error('Raw response:', rawResponse);
    return null;
  }
}

export function calculateChangesSummary(
  currentTitle: string | null,
  currentDescription: string | null,
  proposedTitle: string,
  proposedDescription: string,
  keywordsUsed: string[],
  targetKeywords: BolProductKeywordTarget[]
): {
  title_changed: boolean;
  keywords_added: string[];
  keywords_removed: string[];
  keywords_promoted_to_title: string[];
  description_parts_changed: string[];
  title_chars_before: number;
  title_chars_after: number;
  desc_chars_before: number;
  desc_chars_after: number;
  search_volume_added: number;
} {
  const currentTitleLower = (currentTitle || '').toLowerCase();
  const currentDescLower = (currentDescription || '').toLowerCase();
  const proposedTitleLower = proposedTitle.toLowerCase();
  const proposedDescLower = proposedDescription.toLowerCase();

  // Find keywords added to title
  const keywordsPromotedToTitle = targetKeywords
    .filter(kw => !kw.in_title && proposedTitleLower.includes(kw.keyword.toLowerCase()))
    .map(kw => kw.keyword);

  // Find all keywords in new vs old content
  const keywordsInOldContent = targetKeywords
    .filter(kw => currentTitleLower.includes(kw.keyword.toLowerCase()) || currentDescLower.includes(kw.keyword.toLowerCase()))
    .map(kw => kw.keyword);

  const keywordsInNewContent = targetKeywords
    .filter(kw => proposedTitleLower.includes(kw.keyword.toLowerCase()) || proposedDescLower.includes(kw.keyword.toLowerCase()))
    .map(kw => kw.keyword);

  const keywordsAdded = keywordsInNewContent.filter(kw => !keywordsInOldContent.includes(kw));
  const keywordsRemoved = keywordsInOldContent.filter(kw => !keywordsInNewContent.includes(kw));

  // Calculate total search volume of newly added keywords
  const searchVolumeAdded = keywordsAdded.reduce((sum, kw) => {
    const kwData = targetKeywords.find(k => k.keyword === kw);
    return sum + (kwData?.search_volume || 0);
  }, 0);

  return {
    title_changed: currentTitle !== proposedTitle,
    keywords_added: keywordsAdded,
    keywords_removed: keywordsRemoved,
    keywords_promoted_to_title: keywordsPromotedToTitle,
    description_parts_changed: [], // TODO: detailed diff
    title_chars_before: (currentTitle || '').length,
    title_chars_after: proposedTitle.length,
    desc_chars_before: (currentDescription || '').length,
    desc_chars_after: proposedDescription.length,
    search_volume_added: searchVolumeAdded,
  };
}
