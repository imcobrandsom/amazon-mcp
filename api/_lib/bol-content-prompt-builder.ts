/**
 * Database-driven Prompt Builder
 * Uses versioned prompts from bol_content_prompt_versions table
 */
import { createAdminClient } from './supabase-admin.js';
import type { ContentGenerationContext } from './bol-content-prompts.js';

export interface PromptVersion {
  id: string;
  version_number: number;
  system_instructions: string;
  title_template: string | null;
  description_template: string | null;
  title_rules: {
    min_length?: number;
    max_length?: number;
    required_elements?: string[];
    forbidden_words?: string[];
    keyword_count?: { min: number; max: number };
  };
  description_rules: {
    min_length?: number;
    max_length?: number;
    required_sections?: string[];
    usp_count?: { min: number; max: number };
    keyword_density?: { min: number; max: number };
  };
}

/**
 * Get active prompt version for a customer
 * Returns active version, or random A/B test version if testing is enabled
 */
export async function getActivePromptVersion(customerId: string): Promise<PromptVersion | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_active_prompt_version', {
    p_customer_id: customerId,
  });

  if (error) {
    console.error('[getActivePromptVersion] Error:', error);
    return null;
  }

  if (!data || data.length === 0) {
    console.warn('[getActivePromptVersion] No active version found for customer', customerId);
    return null;
  }

  return data[0] as PromptVersion;
}

/**
 * Fetch content examples for category
 * Returns up to 5 examples (good + bad mix) for few-shot learning
 */
async function fetchCategoryExamples(
  categorySlug: string | null,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{
  goodTitles: Array<{ content: string; reason: string }>;
  badTitles: Array<{ content: string; reason: string }>;
  goodDescriptions: Array<{ content: string; reason: string }>;
  badDescriptions: Array<{ content: string; reason: string }>;
}> {
  // Normalize category slug (lowercase, replace spaces with hyphens)
  const normalizedSlug = categorySlug?.toLowerCase().replace(/\s+/g, '-') || null;

  // Fetch 2 good + 2 bad title examples (rating 5 = good, rating 1 = bad)
  const { data: goodTitles } = await supabase
    .from('content_examples')
    .select('content, reason')
    .eq('marketplace', 'bol')
    .eq('category_slug', normalizedSlug)
    .eq('example_type', 'good_title')
    .eq('rating', 5)
    .order('usage_count', { ascending: false })
    .limit(2);

  const { data: badTitles } = await supabase
    .from('content_examples')
    .select('content, reason')
    .eq('marketplace', 'bol')
    .eq('category_slug', normalizedSlug)
    .eq('example_type', 'bad_title')
    .eq('rating', 1)
    .limit(2);

  const { data: goodDescriptions } = await supabase
    .from('content_examples')
    .select('content, reason')
    .eq('marketplace', 'bol')
    .eq('category_slug', normalizedSlug)
    .eq('example_type', 'good_description')
    .eq('rating', 5)
    .limit(1);

  const { data: badDescriptions } = await supabase
    .from('content_examples')
    .select('content, reason')
    .eq('marketplace', 'bol')
    .eq('category_slug', normalizedSlug)
    .eq('example_type', 'bad_description')
    .eq('rating', 1)
    .limit(1);

  return {
    goodTitles: goodTitles || [],
    badTitles: badTitles || [],
    goodDescriptions: goodDescriptions || [],
    badDescriptions: badDescriptions || [],
  };
}

/**
 * Build prompt using database version
 * Falls back to hardcoded prompt if no version found
 */
export async function buildDatabasePrompt(
  context: ContentGenerationContext,
  customerId: string
): Promise<{ prompt: string; versionId: string | null }> {
  const version = await getActivePromptVersion(customerId);
  const supabase = createAdminClient();

  if (!version) {
    console.log('[buildDatabasePrompt] No version found, using fallback prompt');
    return {
      prompt: buildFallbackPrompt(context),
      versionId: null,
    };
  }

  console.log(`[buildDatabasePrompt] Using version ${version.version_number}`);

  const { product, keywords, categoryRequirements, clientBrief, competitor, currentCompleteness } = context;

  // Fetch category examples for few-shot learning
  const examples = await fetchCategoryExamples(product.category, supabase);
  console.log(`[buildDatabasePrompt] Fetched examples:`, {
    goodTitles: examples.goodTitles.length,
    badTitles: examples.badTitles.length,
    goodDescriptions: examples.goodDescriptions.length,
    badDescriptions: examples.badDescriptions.length,
    category: product.category
  });

  // Extract high-priority keywords
  const highPriorityKeywords = keywords
    .filter(kw => kw.priority >= 7)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  // Extract missing keywords
  const missingKeywords = keywords
    .filter(kw => !kw.in_title && kw.search_volume && kw.search_volume > 100)
    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    .slice(0, 5);

  // Build context variables for template
  const contextVars = {
    ean: product.ean,
    category: product.category || 'Onbekend',
    current_title: product.title || '(geen titel)',
    current_description: product.description ? `${product.description.substring(0, 200)}...` : '(geen description)',
    price: product.price?.toFixed(2) || '0.00',
    completeness_score: currentCompleteness?.overall_score || 0,
    completeness_filled: currentCompleteness?.required_filled || 0,
    completeness_total: currentCompleteness?.required_total || 0,
    high_priority_keywords: highPriorityKeywords.map(kw =>
      `- **${kw.keyword}** (${kw.search_volume?.toLocaleString() || '?'} zoekvolume/maand, prioriteit: ${kw.priority}/10)${kw.in_title ? ' ✓ AL IN TITEL' : ' ✗ NIET IN TITEL'}`
    ).join('\n'),
    missing_keywords: missingKeywords.length > 0
      ? missingKeywords.map(kw => `- ${kw.keyword} (${kw.search_volume?.toLocaleString()} zoekvolume/maand)`).join('\n')
      : 'Geen belangrijke ontbrekende keywords',
    client_brief: clientBrief || 'Geen specifieke richtlijnen',
    competitor_example: competitor
      ? `**Concurrent voorbeeld:**\nTitel: ${competitor.title}\nPrijs: €${competitor.price}`
      : '',
  };

  // Build prompt using template
  let prompt = version.system_instructions;

  prompt += `\n\n## HUIDIGE PRODUCT\n\n`;
  prompt += `**EAN:** ${contextVars.ean}\n`;
  prompt += `**Categorie:** ${contextVars.category}\n`;
  prompt += `**Huidige titel:** ${contextVars.current_title}\n`;
  prompt += `**Huidige description:** ${contextVars.current_description}\n`;
  prompt += `**Prijs:** €${contextVars.price}\n\n`;
  prompt += `**Completeness Score:** ${contextVars.completeness_score}% (${contextVars.completeness_filled}/${contextVars.completeness_total} vereiste attributen ingevuld)\n\n`;

  prompt += `## TARGET KEYWORDS (hoogste prioriteit)\n\n`;
  prompt += contextVars.high_priority_keywords + '\n\n';

  if (missingKeywords.length > 0) {
    prompt += `**BELANGRIJKSTE ONTBREKENDE KEYWORDS:**\n${contextVars.missing_keywords}\n\n`;
  }

  if (clientBrief) {
    prompt += `## KLANT BRIEF\n\n${clientBrief}\n\n`;
  }

  if (competitor) {
    prompt += `## CONCURRENT ANALYSE\n\n${contextVars.competitor_example}\n\n`;
  }

  // Inject content examples (few-shot learning)
  if (examples.goodTitles.length > 0 || examples.badTitles.length > 0 ||
      examples.goodDescriptions.length > 0 || examples.badDescriptions.length > 0) {
    prompt += `## VOORBEELDEN VAN GOEDE/SLECHTE CONTENT\n\n`;

    if (examples.goodTitles.length > 0) {
      prompt += `**✅ GOEDE TITELS:**\n`;
      examples.goodTitles.forEach(ex => {
        prompt += `- "${ex.content}"\n`;
        prompt += `  _Waarom: ${ex.reason}_\n\n`;
      });
    }

    if (examples.badTitles.length > 0) {
      prompt += `**❌ SLECHTE TITELS (VERMIJD DIT):**\n`;
      examples.badTitles.forEach(ex => {
        prompt += `- "${ex.content}"\n`;
        prompt += `  _Waarom slecht: ${ex.reason}_\n\n`;
      });
    }

    if (examples.goodDescriptions.length > 0) {
      prompt += `**✅ GOEDE BESCHRIJVING VOORBEELD:**\n`;
      prompt += `${examples.goodDescriptions[0].content}\n\n`;
      prompt += `_Waarom: ${examples.goodDescriptions[0].reason}_\n\n`;
    }

    if (examples.badDescriptions.length > 0) {
      prompt += `**❌ SLECHTE BESCHRIJVING (VERMIJD DIT):**\n`;
      prompt += `${examples.badDescriptions[0].content}\n\n`;
      prompt += `_Waarom slecht: ${examples.badDescriptions[0].reason}_\n\n`;
    }
  }

  // Inject category-specific guidelines (Phase 2)
  if (categoryRequirements?.content_focus_areas && categoryRequirements.content_focus_areas.length > 0) {
    prompt += `## CATEGORIE SPECIFIEKE RICHTLIJNEN (${product.category})\n\n`;

    if (categoryRequirements.content_focus_areas.length > 0) {
      prompt += `**Focus areas voor deze categorie:**\n`;
      prompt += categoryRequirements.content_focus_areas.map(area => `- ${area}`).join('\n');
      prompt += '\n\n';
    }

    if (categoryRequirements.tone_guidelines) {
      prompt += `**Tone of voice:**\n${categoryRequirements.tone_guidelines}\n\n`;
    }

    if (categoryRequirements.priority_usps && categoryRequirements.priority_usps.length > 0) {
      prompt += `**Prioriteit USPs (vermeld minstens 2):**\n`;
      prompt += categoryRequirements.priority_usps.map(usp => `- ${usp}`).join('\n');
      prompt += '\n\n';
    }

    // Show attribute templates for context
    if (categoryRequirements.attribute_templates && Object.keys(categoryRequirements.attribute_templates).length > 0) {
      prompt += `**Hoe attributen te formuleren:**\n`;
      Object.entries(categoryRequirements.attribute_templates).forEach(([attr, template]) => {
        prompt += `- ${attr}: "${template}"\n`;
      });
      prompt += '\n';
    }
  }

  // Add rules constraints
  prompt += `## REGELS & CONSTRAINTS\n\n`;
  prompt += `**Titel:**\n`;
  prompt += `- Lengte: ${version.title_rules.min_length || 50}-${version.title_rules.max_length || 150} karakters\n`;
  if (version.title_rules.required_elements && version.title_rules.required_elements.length > 0) {
    prompt += `- Verplichte elementen: ${version.title_rules.required_elements.join(', ')}\n`;
  }
  if (version.title_rules.keyword_count) {
    prompt += `- Aantal keywords: ${version.title_rules.keyword_count.min}-${version.title_rules.keyword_count.max}\n`;
  }
  if (version.title_rules.forbidden_words && version.title_rules.forbidden_words.length > 0) {
    prompt += `- Verboden woorden: ${version.title_rules.forbidden_words.join(', ')}\n`;
  }

  prompt += `\n**Beschrijving:**\n`;
  prompt += `- Lengte: ${version.description_rules.min_length || 250}-${version.description_rules.max_length || 2000} karakters\n`;
  if (version.description_rules.required_sections && version.description_rules.required_sections.length > 0) {
    prompt += `- Verplichte secties: ${version.description_rules.required_sections.join(', ')}\n`;
  }
  if (version.description_rules.usp_count) {
    prompt += `- Aantal USPs: ${version.description_rules.usp_count.min}-${version.description_rules.usp_count.max}\n`;
  }

  prompt += `\n## OUTPUT FORMAT\n\n`;
  prompt += `Genereer JSON met deze structuur:\n`;
  prompt += `\`\`\`json\n`;
  prompt += `{\n`;
  prompt += `  "title": "Geoptimaliseerde titel hier",\n`;
  prompt += `  "description": "Geoptimaliseerde HTML beschrijving hier",\n`;
  prompt += `  "description_parts": {\n`;
  prompt += `    "intro": "Introductie alinea",\n`;
  prompt += `    "usps": ["USP 1", "USP 2", "USP 3"],\n`;
  prompt += `    "details": "Details alinea"\n`;
  prompt += `  },\n`;
  prompt += `  "keywords_used": ["keyword1", "keyword2", "keyword3"],\n`;
  prompt += `  "reasoning": "Uitleg waarom deze aanpak werkt"\n`;
  prompt += `}\n`;
  prompt += `\`\`\``;

  return {
    prompt,
    versionId: version.id,
  };
}

/**
 * Fallback prompt when no database version exists
 * (Same as original hardcoded prompt)
 */
function buildFallbackPrompt(context: ContentGenerationContext): string {
  const { product, keywords } = context;

  const highPriorityKeywords = keywords
    .filter(kw => kw.priority >= 7)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  return `Je bent een expert Bol.com content optimizer gespecialiseerd in Nederlandse e-commerce SEO.

## HUIDIGE PRODUCT

**EAN:** ${product.ean}
**Categorie:** ${product.category || 'Onbekend'}
**Huidige titel:** ${product.title || '(geen titel)'}

## TARGET KEYWORDS

${highPriorityKeywords.map(kw =>
  `- **${kw.keyword}** (prioriteit: ${kw.priority}/10)`
).join('\n')}

Genereer geoptimaliseerde content in JSON format.`;
}

/**
 * Update performance metrics after generation
 */
export async function updatePromptPerformance(
  versionId: string,
  titleLength: number,
  descriptionLength: number,
  keywordsAdded: number
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.rpc('update_prompt_performance', {
    p_version_id: versionId,
    p_title_length: titleLength,
    p_description_length: descriptionLength,
    p_keywords_added: keywordsAdded,
  });

  if (error) {
    console.error('[updatePromptPerformance] Error:', error);
  }
}
