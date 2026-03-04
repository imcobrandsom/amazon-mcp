/**
 * Onderzoekt de diepte van category paths in bol_product_categories
 * GET /api/test-category-depth?customerId=XXX
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import { getBolToken, getProductPlacement, extractDeepestCategoryId } from './_lib/bol-api-client.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = (req.query.customerId as string) || FASHIONPOWER_ID;
  const supabase = createAdminClient();

  try {
    // 1. Haal alle category paths op uit de database
    const { data: rows, error } = await supabase
      .from('bol_product_categories')
      .select('ean, category_id, category_slug, category_name, category_path')
      .eq('bol_customer_id', customerId)
      .not('category_path', 'is', null);

    if (error || !rows || rows.length === 0) {
      return res.status(200).json({ message: 'Geen data gevonden', error });
    }

    // 2. Analyseer de paths die al in de DB staan
    const pathAnalysis = rows.map(row => {
      const path = row.category_path as string;
      const parts = path ? path.split(' > ') : [];
      return {
        ean: row.ean,
        category_id: row.category_id,
        category_slug: row.category_slug,
        path,
        depth: parts.length,
        parts,
      };
    });

    // Sorteer op diepte (deepest first)
    pathAnalysis.sort((a, b) => b.depth - a.depth);

    // Unieke paths (één rij per pad)
    const uniquePaths = new Map<string, typeof pathAnalysis[0]>();
    for (const row of pathAnalysis) {
      if (!uniquePaths.has(row.path)) uniquePaths.set(row.path, row);
    }
    const uniquePathList = Array.from(uniquePaths.values()).sort((a, b) => b.depth - a.depth);

    // Verdeling van dieptes
    const depthDistribution: Record<number, number> = {};
    for (const row of pathAnalysis) {
      depthDistribution[row.depth] = (depthDistribution[row.depth] || 0) + 1;
    }

    // 3. Haal LIVE placement op voor de 5 diepste + 5 ondiepste paths om te vergelijken
    const { data: customer } = await supabase
      .from('bol_customers')
      .select('bol_client_id, bol_client_secret')
      .eq('id', customerId)
      .single();

    const liveSamples: Array<{
      ean: string;
      stored_path: string;
      stored_depth: number;
      stored_category_id: string;
      live_categories_count: number;
      live_paths: Array<{ path: string; depth: number; leaf_id: string | null }>;
      extracted_id: string | null;
      id_matches_stored: boolean;
    }> = [];

    if (customer) {
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      // Neem 3 diepste + 3 ondiepste unieke paths als sample
      const samplePaths = [
        ...uniquePathList.slice(0, 3),
        ...uniquePathList.slice(-3),
      ];
      // Filter duplicates
      const seen = new Set<string>();
      const dedupedSamples = samplePaths.filter(p => {
        if (seen.has(p.ean)) return false;
        seen.add(p.ean);
        return true;
      });

      for (const sample of dedupedSamples) {
        try {
          const placement = await getProductPlacement(token, sample.ean);
          if (!placement?.categories) {
            liveSamples.push({
              ean: sample.ean,
              stored_path: sample.path,
              stored_depth: sample.depth,
              stored_category_id: sample.category_id,
              live_categories_count: 0,
              live_paths: [],
              extracted_id: null,
              id_matches_stored: false,
            });
            continue;
          }

          // Extraheer alle paden uit de live response
          const livePaths: Array<{ path: string; depth: number; leaf_id: string | null }> = [];

          function extractAllPaths(
            cats: Array<{ categoryId?: string; id?: string; categoryName?: string; name?: string; subcategories?: typeof cats }>,
            currentPath: string[] = [],
            currentIds: string[] = []
          ) {
            for (const cat of cats) {
              const name = cat.categoryName || cat.name || '?';
              const id = cat.categoryId || cat.id || null;
              const newPath = [...currentPath, name];
              const newIds = id ? [...currentIds, id] : currentIds;

              if (!cat.subcategories || cat.subcategories.length === 0) {
                // Blad-knooppunt
                livePaths.push({
                  path: newPath.join(' > '),
                  depth: newPath.length,
                  leaf_id: id,
                });
              } else {
                extractAllPaths(cat.subcategories, newPath, newIds);
              }
            }
          }

          extractAllPaths(placement.categories as Parameters<typeof extractAllPaths>[0]);

          const extractedId = extractDeepestCategoryId(placement);

          liveSamples.push({
            ean: sample.ean,
            stored_path: sample.path,
            stored_depth: sample.depth,
            stored_category_id: sample.category_id,
            live_categories_count: placement.categories.length,
            live_paths: livePaths.sort((a, b) => b.depth - a.depth),
            extracted_id: extractedId,
            id_matches_stored: extractedId === sample.category_id,
          });

          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          console.warn(`[test-category-depth] Placement mislukt voor ${sample.ean}:`, err);
        }
      }
    }

    return res.status(200).json({
      summary: {
        total_products: rows.length,
        unique_paths: uniquePathList.length,
        depth_distribution: depthDistribution,
        max_depth: Math.max(...pathAnalysis.map(r => r.depth)),
        min_depth: Math.min(...pathAnalysis.map(r => r.depth)),
        avg_depth: Math.round(pathAnalysis.reduce((s, r) => s + r.depth, 0) / pathAnalysis.length * 10) / 10,
      },
      unique_paths_by_depth: uniquePathList,
      live_placement_samples: liveSamples,
    });

  } catch (err) {
    console.error('[test-category-depth] Fatal error:', err);
    return res.status(500).json({ error: (err as Error).message });
  }
}
