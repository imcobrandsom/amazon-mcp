/**
 * POST /api/bol-keywords-populate
 * Auto-populates bol_product_keyword_targets from advertising campaign data
 * Maps keywords to products via ad group product targets
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getBolToken,
  getAdsToken,
  getAdsCampaigns,
  getAdsAdGroups,
  getAdsProductTargets,
  getAdsKeywords,
} from './_lib/bol-api-client.js';

interface KeywordToInsert {
  bol_customer_id: string;
  ean: string;
  keyword: string;
  priority: number;
  source: string;
  search_volume: number | null;
  impressions_last_30d: number | null;
  clicks_last_30d: number | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();

  // Get customer credentials
  const { data: customer, error: custErr } = await supabase
    .from('bol_customers')
    .select('bol_client_id, bol_client_secret, ads_client_id')
    .eq('id', customerId)
    .single();

  if (custErr || !customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (!customer.ads_client_id) {
    return res.status(400).json({
      error: 'No advertising credentials configured for this customer'
    });
  }

  // Get advertising API token
  let adsToken: string;
  try {
    // Get ads credentials from secure table
    const { data: adsCreds } = await supabase
      .from('bol_customers')
      .select('ads_client_secret')
      .eq('id', customerId)
      .single();

    if (!adsCreds?.ads_client_secret) {
      return res.status(400).json({ error: 'Ads client secret not found' });
    }

    adsToken = await getAdsToken(customer.ads_client_id, adsCreds.ads_client_secret);
  } catch (err) {
    console.error('Failed to get ads token:', err);
    return res.status(500).json({
      error: 'Failed to authenticate with Bol Advertising API',
      details: (err as Error).message,
    });
  }

  const keywordsToInsert: KeywordToInsert[] = [];
  let campaignsProcessed = 0;
  let adGroupsProcessed = 0;
  let keywordsFound = 0;

  try {
    // Step 1: Fetch all campaigns
    console.log('Fetching campaigns...');
    const campaigns = await getAdsCampaigns(adsToken);
    console.log(`Found ${campaigns.length} campaigns`);

    // Step 2: For each campaign, fetch ad groups and their keywords + product targets
    for (const campaign of campaigns) {
      const campaignData = campaign as any;
      const campaignId = campaignData.campaignId;

      if (!campaignId) continue;

      try {
        // Fetch ad groups for this campaign
        const adGroups = await getAdsAdGroups(adsToken, campaignId);
        campaignsProcessed++;

        for (const adGroup of adGroups) {
          const adGroupData = adGroup as any;
          const adGroupId = adGroupData.adGroupId;

          if (!adGroupId) continue;

          // Fetch keywords for this ad group
          const keywords = await getAdsKeywords(adsToken, adGroupId);

          // Fetch product targets (EANs) for this ad group
          const eans = await getAdsProductTargets(adsToken, adGroupId);

          adGroupsProcessed++;

          // Map keywords to EANs
          for (const keyword of keywords) {
            const kwData = keyword as any;
            const keywordText = kwData.keywordText || kwData.keyword;
            const state = kwData.state || kwData.status;

            if (!keywordText || state === 'ARCHIVED') continue;

            keywordsFound++;

            // Determine priority based on performance (if available)
            let priority = 5; // default
            const bid = kwData.bid ? parseFloat(kwData.bid) : null;

            // Higher bid = higher priority (rough heuristic)
            if (bid) {
              if (bid >= 2.0) priority = 9;
              else if (bid >= 1.5) priority = 8;
              else if (bid >= 1.0) priority = 7;
              else if (bid >= 0.5) priority = 6;
            }

            // Associate this keyword with all EANs in the ad group
            for (const ean of eans) {
              keywordsToInsert.push({
                bol_customer_id: customerId,
                ean,
                keyword: keywordText.toLowerCase().trim(),
                priority,
                source: 'advertising',
                search_volume: null, // Will be filled by keyword sync
                impressions_last_30d: null,
                clicks_last_30d: null,
              });
            }
          }

          // Rate limit spacing (250ms between ad groups)
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch (campErr) {
        console.error(`Error processing campaign ${campaignId}:`, campErr);
        // Continue with next campaign
      }
    }

    // Step 3: Bulk insert keywords (deduped by UNIQUE constraint)
    if (keywordsToInsert.length === 0) {
      return res.status(200).json({
        message: 'No keywords found in advertising campaigns',
        campaigns_processed: campaignsProcessed,
        ad_groups_processed: adGroupsProcessed,
        keywords_inserted: 0,
      });
    }

    console.log(`Inserting ${keywordsToInsert.length} keyword-product mappings...`);

    // Batch insert in chunks of 1000 to avoid query size limits
    let inserted = 0;
    const chunkSize = 1000;

    for (let i = 0; i < keywordsToInsert.length; i += chunkSize) {
      const chunk = keywordsToInsert.slice(i, i + chunkSize);

      const { error: insertErr } = await supabase
        .from('bol_product_keyword_targets')
        .insert(chunk)
        .select('id');

      if (insertErr) {
        // Check if it's a duplicate key error (expected)
        if (insertErr.code === '23505') {
          console.log(`Chunk ${i / chunkSize + 1}: Some keywords already exist (skipped duplicates)`);
        } else {
          console.error('Insert error:', insertErr);
        }
      } else {
        inserted += chunk.length;
      }
    }

    return res.status(200).json({
      message: 'Keywords populated from advertising campaigns',
      campaigns_processed: campaignsProcessed,
      ad_groups_processed: adGroupsProcessed,
      keywords_found: keywordsFound,
      keyword_product_mappings: keywordsToInsert.length,
      unique_keywords_inserted: inserted,
      note: 'Run /api/bol-keyword-sync to fetch search volumes and update content presence flags',
    });

  } catch (err) {
    console.error('Keyword population error:', err);
    return res.status(500).json({
      error: 'Failed to populate keywords',
      details: (err as Error).message,
      campaigns_processed: campaignsProcessed,
      ad_groups_processed: adGroupsProcessed,
    });
  }
}
