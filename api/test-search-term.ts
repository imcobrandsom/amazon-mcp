/**
 * GET /api/test-search-term?keyword=sportlegging
 * Test endpoint voor Search Terms API debugging
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBolToken, getSearchTerms } from './_lib/bol-api-client.js';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const keyword = (req.query.keyword as string) || 'sportlegging';
  const periods = parseInt(req.query.periods as string) || 26;

  const supabase = createAdminClient();
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('bol_client_id, bol_client_secret, seller_name')
    .eq('id', 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8')
    .single();

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  try {
    const token = await getBolToken(
      customer.bol_client_id as string,
      customer.bol_client_secret as string
    );

    const url = `https://api.bol.com/retailer/insights/search-terms?search-term=${encodeURIComponent(keyword)}&period=WEEK&number-of-periods=${periods}`;

    const result = await getSearchTerms(token, keyword, 'WEEK', periods);

    // Analyse
    const hasData = result.searchTerms.length > 0;
    const st = hasData ? result.searchTerms[0] : null;
    const periodsReturned = st?.periods?.length ?? 0;
    const nonZeroPeriods = st?.periods?.filter(p => p.count > 0).length ?? 0;

    return res.status(200).json({
      customer: customer.seller_name,
      keyword,
      url,
      hasData,
      searchTermsCount: result.searchTerms.length,
      analysis: hasData ? {
        searchTerm: st!.searchTerm,
        total: st!.total,
        periodsReturned,
        nonZeroPeriods,
        firstFivePeriods: st!.periods?.slice(0, 5).map((p, i) => ({
          week: i,
          count: p.count
        })) ?? []
      } : null,
      rawResponse: result
    });
  } catch (err) {
    return res.status(500).json({
      error: (err as Error).message,
      keyword,
      customer: customer.seller_name
    });
  }
}
