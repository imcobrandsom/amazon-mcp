import Anthropic from '@anthropic-ai/sdk';
import type { BolContentDescriptionParts, BolContentChangesSummary } from '../../src/types/bol';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface GenerateContentInput {
  ean: string;
  currentTitle: string | null;
  currentDescription: string | null;
  basisTitle: string | null;
  basisDescription: string | null;
  clientBrief: string;
  topKeywords: string[];           // from bol_keyword_search_volume, top 15 by volume
  trendingKeywords: string[];      // keywords with volume_trend='up' in last 2 weeks
  competitorTitles: string[];      // from bol_competitor_catalog for same category
  competitorUsps: string[];        // extracted_usps from bol_competitor_content_analysis
}

export interface GenerateContentOutput {
  proposed_title: string;
  proposed_description: string;
  proposed_description_parts: BolContentDescriptionParts;
  score_after_estimate: number;
  changes_summary: BolContentChangesSummary;
}

export async function generateBolContent(input: GenerateContentInput): Promise<GenerateContentOutput> {
  const systemPrompt = `Je bent een expert Bol.com content schrijver die producttitels en omschrijvingen schrijft in het Nederlands.

Bol.com best practices:
- Titel: 150–175 tekens. Formaat: [Merk] [Producttype] [Kernkenmerk] [Variant] [Doelgroep]. Begin altijd met het sterkste zoekwoord.
- Omschrijving intro: minimaal 100 tekens, pakkende eerste zin die de productwaarde direct duidelijk maakt.
- USPs: minimaal 5 bullet points (• symbool), elk 20–80 tekens, beginnen met het voordeel. Geen verboden claims (eco, duurzaam, milieuvriendelijk, CO2-neutraal tenzij gecertificeerd).
- Lange omschrijving: 200–400 tekens aanvullende productinformatie.
- Verboden woorden: Milieuvriendelijk, Eco, Duurzaam, Biologisch afbreekbaar, CO2-neutraal, Klimaatneutraal (tenzij aantoonbaar gecertificeerd).
- Schrijf altijd in het Nederlands.
- Verwerk trending zoekwoorden natuurlijk in de tekst, niet als keyword stuffing.

${input.clientBrief ? `Klantbriefing:\n${input.clientBrief}` : ''}`;

  const userPrompt = `Schrijf een Bol.com titel en omschrijving voor EAN: ${input.ean}

BASISCONTENT (aangeleverd door klant — gebruik dit als feitelijke basis):
Titel: ${input.basisTitle ?? '(niet beschikbaar)'}
Omschrijving: ${input.basisDescription ?? '(niet beschikbaar)'}

HUIDIGE CONTENT OP BOL.COM:
Titel: ${input.currentTitle ?? '(leeg)'}
Omschrijving: ${input.currentDescription ?? '(leeg)'}

TOP ZOEKWOORDEN (op volume):
${input.topKeywords.join(', ')}

TRENDING ZOEKWOORDEN (stijgend volume afgelopen 2 weken):
${input.trendingKeywords.join(', ')}

COMPETITOR TITELS (zelfde categorie, ter referentie):
${input.competitorTitles.slice(0, 5).map(t => `- ${t}`).join('\n')}

COMPETITOR USPs (populaire verkoopargumenten in de categorie):
${input.competitorUsps.slice(0, 10).map(u => `- ${u}`).join('\n')}

Geef je antwoord in dit exacte JSON-formaat:
{
  "title": "...",
  "description_intro": "...",
  "description_usps": ["• ...", "• ...", "• ...", "• ...", "• ..."],
  "description_long": "..."
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response did not contain valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  const proposed_title: string = parsed.title ?? '';
  const proposed_description_parts: BolContentDescriptionParts = {
    intro: parsed.description_intro ?? '',
    usps: parsed.description_usps ?? [],
    long: parsed.description_long ?? '',
  };
  const proposed_description = [
    proposed_description_parts.intro,
    proposed_description_parts.usps.join('\n'),
    proposed_description_parts.long,
  ].filter(Boolean).join('\n\n');

  // Estimate score after
  const titleLen = proposed_title.length;
  let scoreEst = 0;
  if (titleLen >= 150 && titleLen <= 175) scoreEst += 50;
  else if (titleLen > 0) scoreEst += 30;
  if (proposed_description_parts.intro.length >= 100) scoreEst += 15;
  if (proposed_description_parts.usps.length >= 5) scoreEst += 25;
  else if (proposed_description_parts.usps.length >= 3) scoreEst += 15;
  if (proposed_description_parts.long.length >= 100) scoreEst += 10;

  // Build changes summary
  const currentKeywords = extractKeywords(input.currentTitle ?? '', input.currentDescription ?? '');
  const proposedKeywords = extractKeywords(proposed_title, proposed_description);
  const changes_summary: BolContentChangesSummary = {
    title_changed: proposed_title !== input.currentTitle,
    keywords_added: proposedKeywords.filter(k => !currentKeywords.includes(k)),
    keywords_removed: currentKeywords.filter(k => !proposedKeywords.includes(k)),
    keywords_promoted_to_title: proposedKeywords.filter(k =>
      !extractKeywords(input.currentTitle ?? '', '').includes(k) &&
      extractKeywords(proposed_title, '').includes(k)
    ),
    description_parts_changed: getChangedParts(input.currentDescription ?? '', proposed_description_parts),
    title_chars_before: input.currentTitle?.length ?? 0,
    title_chars_after: proposed_title.length,
    desc_chars_before: input.currentDescription?.length ?? 0,
    desc_chars_after: proposed_description.length,
  };

  return {
    proposed_title,
    proposed_description,
    proposed_description_parts,
    score_after_estimate: scoreEst,
    changes_summary,
  };
}

// Simple keyword extraction: split on whitespace + punctuation, filter short words
function extractKeywords(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  return [...new Set(
    text.split(/[\s,.\-•]+/).filter(w => w.length > 4)
  )];
}

function getChangedParts(currentDesc: string, parts: BolContentDescriptionParts): string[] {
  const changed: string[] = [];
  if (!currentDesc.includes(parts.intro.substring(0, 50))) changed.push('intro');
  if (parts.usps.length > 0) changed.push('usps');
  if (parts.long && !currentDesc.includes(parts.long.substring(0, 50))) changed.push('long');
  return changed;
}
