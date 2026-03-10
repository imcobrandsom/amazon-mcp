/**
 * POST /api/bol-keywords-ai-cron
 * AI keyword extraction – processes up to 10 products per run.
 *
 * Cron: */15 * * * * (every 15 minutes, as configured in vercel.json)
 * Completes a full cycle of ~300 products in ~7.5h, then immediately restarts.
 *
 * Strategy:
 * - Process 10 products per run (up to 10 × 2s AI = ~20s, within 60s maxDuration)
 * - Track batch progress in bol_ai_extraction_progress table
 * - Track per-product content hashes in bol_ai_product_hashes table
 * - Skip products whose content (title + description + basis) hasn't changed → no AI call
 * - Extracts product-specific keywords (not generic category keywords)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { createAdminClient } from './_lib/supabase-admin.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Compute a content fingerprint for a product.
 * Any change in title, description, or content-basis fields will yield a different hash.
 */
function computeContentHash(
  title: string,
  description: string,
  basisTitle?: string,
  basisDescription?: string,
): string {
  const raw = [title, description, basisTitle ?? '', basisDescription ?? ''].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const BATCH_SIZE = 10; // Products to process per cron run
const AI_RATE_LIMIT_MS = 2000; // 2 seconds between AI calls

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = createAdminClient();

  try {
    // Check if specific customer requested (manual trigger)
    const { customerId } = req.body || {};

    let customers;
    if (customerId) {
      // Manual trigger for specific customer
      const { data } = await supabase
        .from('bol_customers')
        .select('id, seller_name')
        .eq('id', customerId)
        .single();

      customers = data ? [data] : [];
    } else {
      // Cron job - process all active customers
      const { data } = await supabase
        .from('bol_customers')
        .select('id, seller_name')
        .eq('active', true);

      customers = data || [];
    }

    if (!customers || customers.length === 0) {
      return res.status(200).json({ message: 'No active customers', processed: 0 });
    }

    const results = [];

    for (const customer of customers) {
      console.log(`[ai-cron] Processing customer: ${customer.seller_name} (${customer.id})`);

      // Get or create progress record
      let { data: progress } = await supabase
        .from('bol_ai_extraction_progress')
        .select('*')
        .eq('bol_customer_id', customer.id)
        .single();

      if (!progress) {
        // First run - create progress record
        const { data: newProgress } = await supabase
          .from('bol_ai_extraction_progress')
          .insert({
            bol_customer_id: customer.id,
            last_processed_ean: null,
            total_products: 0,
            products_processed: 0,
            cycle_number: 1,
          })
          .select()
          .single();

        progress = newProgress;
      }

      // Get inventory
      const { data: inventorySnap } = await supabase
        .from('bol_raw_snapshots')
        .select('raw_data')
        .eq('bol_customer_id', customer.id)
        .eq('data_type', 'inventory')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single();

      if (!inventorySnap) {
        console.log(`[ai-cron] No inventory for ${customer.seller_name}`);
        continue;
      }

      const inventory = ((inventorySnap.raw_data as any)?.items || (inventorySnap.raw_data as any)?.inventory || []) as Array<{
        ean?: string;
        title?: string;
        description?: string;
      }>;

      // Filter products with content
      const productsWithContent = inventory.filter(p => p.ean && (p.title || p.description));

      if (productsWithContent.length === 0) {
        console.log(`[ai-cron] No products with content for ${customer.seller_name}`);
        continue;
      }

      // Find starting position
      let startIndex = 0;
      if (progress.last_processed_ean) {
        const lastIndex = productsWithContent.findIndex(p => p.ean === progress.last_processed_ean);
        startIndex = lastIndex !== -1 ? lastIndex + 1 : 0;
      }

      // Wrap around if we've reached the end
      if (startIndex >= productsWithContent.length) {
        startIndex = 0;
        // Increment cycle number
        await supabase
          .from('bol_ai_extraction_progress')
          .update({ cycle_number: (progress.cycle_number || 1) + 1 })
          .eq('bol_customer_id', customer.id);
      }

      // Get batch to process
      const batch = productsWithContent.slice(startIndex, startIndex + BATCH_SIZE);

      console.log(`[ai-cron] Processing ${batch.length} products (${startIndex + 1}-${startIndex + batch.length} of ${productsWithContent.length})`);

      // Get category mapping
      const { data: categories } = await supabase
        .from('bol_product_categories')
        .select('ean, category_slug')
        .eq('bol_customer_id', customer.id);

      const eanToCategory = new Map((categories || []).map(c => [c.ean, c.category_slug]));

      // Get content basis
      const { data: contentBasis } = await supabase
        .from('bol_content_base')
        .select('ean, title, description')
        .eq('bol_customer_id', customer.id);

      const eanToContentBasis = new Map(
        (contentBasis || []).map(cb => [cb.ean, { title: cb.title, description: cb.description }])
      );

      // Load stored content hashes for change detection (only fetch EANs in the batch)
      const batchEans = batch.map(p => p.ean).filter(Boolean) as string[];
      const { data: existingHashes } = await supabase
        .from('bol_ai_product_hashes')
        .select('ean, content_hash')
        .eq('bol_customer_id', customer.id)
        .in('ean', batchEans);

      const productHashMap = new Map(
        (existingHashes || []).map(h => [h.ean, h.content_hash])
      );

      const keywordsToInsert: Array<{
        bol_customer_id: string;
        ean: string;
        keyword: string;
        priority: number;
        source: string;
      }> = [];

      const hashesToUpsert: Array<{
        bol_customer_id: string;
        ean: string;
        content_hash: string;
        last_extracted_at: string;
      }> = [];

      let lastProcessedEan = progress.last_processed_ean;
      let skippedCount = 0;

      // Process each product with AI
      for (const product of batch) {
        if (!product.ean) continue;

        const currentTitle = product.title || '';
        const currentDescription = product.description || '';
        const basisContent = eanToContentBasis.get(product.ean);
        const categorySlug = eanToCategory.get(product.ean);

        // --- Change detection: skip if content hasn't changed ---
        const currentHash = computeContentHash(
          currentTitle,
          currentDescription,
          basisContent?.title,
          basisContent?.description,
        );

        if (productHashMap.get(product.ean) === currentHash) {
          console.log(`[ai-cron] Skipping EAN ${product.ean} – content unchanged`);
          lastProcessedEan = product.ean; // Advance cursor even for skipped products
          skippedCount++;
          continue;
        }

        const prompt = `Je bent een SEO keyword expert voor Bol.com. Analyseer de volgende productcontent en extraheer relevante zoekwoorden.

**Huidige content:**
Titel: ${currentTitle}
Beschrijving: ${currentDescription.substring(0, 500)}

${basisContent ? `**Originele klant content (referentie):**
Titel: ${basisContent.title || 'Niet beschikbaar'}
Beschrijving: ${basisContent.description?.substring(0, 500) || 'Niet beschikbaar'}` : ''}

${categorySlug ? `**Productcategorie:** ${categorySlug}` : ''}

**Taak:**
1. Extraheer SPECIFIEKE keywords die **al in de content staan** (uit titel én beschrijving)
2. Suggereer PRODUCT-SPECIFIEKE keywords die er **zou moeten staan** op basis van:
   - Exacte productkenmerken (kleur, maat, materiaal)
   - Specifieke eigenschappen genoemd in de content
   - USPs die in de klant content staan
   - Nederlandse Bol.com zoektermen

**BELANGRIJK:**
- Gebruik ALLEEN keywords die SPECIFIEK zijn voor DIT product
- GEEN generieke category keywords (zoals "sportkleding" of "sportlegging")
- Focus op unieke eigenschappen (bijv. "mesh", "hoge taille", "naadloos")
- Geen merknamen verzinnen die niet in de content staan

Return ALLEEN een JSON array:
[
  {"keyword": "keyword phrase", "priority": 1-10, "in_content": true/false}
]

Priority schaal:
10 = Primaire unieke eigenschap
8-9 = Belangrijke specifieke eigenschappen
6-7 = Secundaire eigenschappen
4-5 = Gebruik/doelgroep specifiek`;

        try {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 800,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }],
          });

          const content = response.content[0];
          if (content.type === 'text') {
            const jsonMatch = content.text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const extractedKeywords = JSON.parse(jsonMatch[0]) as Array<{
                keyword: string;
                priority: number;
                in_content: boolean;
              }>;

              for (const kw of extractedKeywords) {
                keywordsToInsert.push({
                  bol_customer_id: customer.id,
                  ean: product.ean,
                  keyword: kw.keyword.toLowerCase().trim(),
                  priority: Math.min(10, Math.max(1, kw.priority)),
                  source: kw.in_content ? 'content_analysis' : 'ai_suggestion',
                });
              }

              console.log(`[ai-cron] Extracted ${extractedKeywords.length} keywords for EAN ${product.ean}`);
            }
          }

          lastProcessedEan = product.ean;

          // Queue hash update so this product is skipped on next run if content unchanged
          hashesToUpsert.push({
            bol_customer_id: customer.id,
            ean: product.ean,
            content_hash: currentHash,
            last_extracted_at: new Date().toISOString(),
          });

          // Rate limit
          await new Promise(resolve => setTimeout(resolve, AI_RATE_LIMIT_MS));

        } catch (aiErr) {
          console.error(`[ai-cron] AI extraction failed for EAN ${product.ean}:`, aiErr);
          // Do NOT update hash on failure – product will be retried next cycle
        }
      }

      // Insert keywords
      if (keywordsToInsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('bol_product_keyword_targets')
          .upsert(keywordsToInsert, {
            onConflict: 'bol_customer_id,ean,keyword',
            ignoreDuplicates: false,
          });

        if (insertErr) {
          console.error(`[ai-cron] Insert error:`, insertErr.message);
        } else {
          console.log(`[ai-cron] Inserted ${keywordsToInsert.length} keywords`);
        }
      }

      // Persist content hashes for successfully processed products
      if (hashesToUpsert.length > 0) {
        const { error: hashErr } = await supabase
          .from('bol_ai_product_hashes')
          .upsert(hashesToUpsert, { onConflict: 'bol_customer_id,ean', ignoreDuplicates: false });

        if (hashErr) {
          console.error(`[ai-cron] Hash upsert error:`, hashErr.message);
        } else {
          console.log(`[ai-cron] Stored hashes for ${hashesToUpsert.length} products`);
        }
      }

      console.log(`[ai-cron] Batch summary: ${hashesToUpsert.length} processed, ${skippedCount} skipped (unchanged)`);

      // Update progress
      await supabase
        .from('bol_ai_extraction_progress')
        .update({
          last_processed_ean: lastProcessedEan,
          total_products: productsWithContent.length,
          products_processed: Math.min(startIndex + batch.length, productsWithContent.length),
          last_run_at: new Date().toISOString(),
        })
        .eq('bol_customer_id', customer.id);

      const hasMoreProducts = (startIndex + batch.length) < productsWithContent.length;

      results.push({
        customer: customer.seller_name,
        batch_size: batch.length,
        processed: hashesToUpsert.length,
        skipped_unchanged: skippedCount,
        keywords_extracted: keywordsToInsert.length,
        progress: `${startIndex + batch.length}/${productsWithContent.length}`,
        has_more: hasMoreProducts,
      });

      // Self-trigger next batch if more products remain
      if (hasMoreProducts) {
        console.log(`[ai-cron] More products remaining for ${customer.seller_name}, triggering next batch...`);

        // Trigger self asynchronously (don't wait for response)
        const host = req.headers.host || 'amazon-mcp-eight.vercel.app';
        fetch(`https://${host}/api/bol-keywords-ai-cron`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: customer.id }),
        }).catch(err => {
          console.error(`[ai-cron] Failed to trigger next batch:`, err.message);
        });
      } else {
        console.log(`[ai-cron] ✅ Completed full cycle for ${customer.seller_name}`);
      }
    }

    return res.status(200).json({
      message: 'AI keyword extraction completed',
      results,
      next_batch_triggered: results.some(r => r.has_more),
    });

  } catch (error) {
    console.error('[ai-cron] Error:', error);
    return res.status(500).json({
      error: 'AI keyword extraction failed',
      details: (error as Error).message,
    });
  }
}
