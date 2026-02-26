/**
 * Cron 2 — /api/bol-sync-complete
 * Schedule: every 5 minutes (see vercel.json)
 *
 * Picks up all pending bol_sync_jobs and checks whether bol.com has finished
 * the async export. When a job is SUCCESS:
 *  - Downloads the CSV
 *  - Stores raw snapshot
 *  - Runs content analysis
 *  - Marks job as completed
 *
 * Jobs that fail or exceed 24 hours are marked as failed.
 *
 * Auth: same as bol-sync-start (CRON_SECRET or x-webhook-secret).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient }    from './_lib/supabase-admin.js';
import { getBolToken, checkProcessStatus, downloadOffersExport } from './_lib/bol-api-client.js';
import { analyzeContent } from './_lib/bol-analysis.js';

const MAX_JOB_AGE_HOURS = 24;
const MAX_ATTEMPTS      = 50; // 50 × 5 min = ~4 hours of polling

function isAuthorised(req: VercelRequest): boolean {
  const cronSecret    = process.env.CRON_SECRET;
  const webhookSecret = process.env.BOL_WEBHOOK_SECRET;
  const auth          = req.headers['authorization'] ?? '';
  const manual        = req.headers['x-webhook-secret'];
  return (cronSecret && auth === `Bearer ${cronSecret}`)
      || (webhookSecret && manual === webhookSecret)
      || false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase  = createAdminClient();
  const startedAt = Date.now();
  const cutoff    = new Date(Date.now() - MAX_JOB_AGE_HOURS * 3600 * 1000).toISOString();

  // Load all pending jobs newer than the cutoff
  const { data: pendingJobs, error: jobsErr } = await supabase
    .from('bol_sync_jobs')
    .select('id, bol_customer_id, data_type, process_status_id, attempts')
    .eq('status', 'pending')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: true });

  if (jobsErr) return res.status(500).json({ error: jobsErr.message });

  // Also expire very old jobs that slipped through
  await supabase
    .from('bol_sync_jobs')
    .update({ status: 'failed', error: 'Expired after 24h', completed_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('started_at', cutoff);

  if (!pendingJobs?.length) {
    return res.status(200).json({ message: 'No pending jobs', checked: 0, duration_ms: Date.now() - startedAt });
  }

  // Load customer credentials (deduplicated by customer)
  const customerIds = [...new Set(pendingJobs.map(j => j.bol_customer_id as string))];
  const { data: customers } = await supabase
    .from('bol_customers')
    .select('id, bol_client_id, bol_client_secret, seller_name')
    .in('id', customerIds);

  const customerMap = new Map((customers ?? []).map(c => [c.id as string, c]));

  const results: Array<{ jobId: string; status: string; detail: string }> = [];

  for (const job of pendingJobs) {
    const jobId    = job.id as string;
    const customer = customerMap.get(job.bol_customer_id as string);

    if (!customer) {
      await supabase.from('bol_sync_jobs').update({ status: 'failed', error: 'Customer not found', completed_at: new Date().toISOString() }).eq('id', jobId);
      results.push({ jobId, status: 'failed', detail: 'Customer not found' });
      continue;
    }

    // Expire jobs that have been polled too many times
    if ((job.attempts as number) >= MAX_ATTEMPTS) {
      await supabase.from('bol_sync_jobs').update({ status: 'failed', error: `Exceeded max attempts (${MAX_ATTEMPTS})`, completed_at: new Date().toISOString() }).eq('id', jobId);
      results.push({ jobId, status: 'failed', detail: 'Max attempts exceeded' });
      continue;
    }

    try {
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      const { status, entityId } = await checkProcessStatus(token, job.process_status_id as string);

      // Increment attempt count
      await supabase.from('bol_sync_jobs').update({ attempts: (job.attempts as number) + 1 }).eq('id', jobId);

      if (status === 'SUCCESS' && entityId) {
        // ── Download + process ──────────────────────────────────────────────
        const offers   = await downloadOffersExport(token, entityId);
        const analysis = analyzeContent(offers);

        const { data: snap } = await supabase.from('bol_raw_snapshots').insert({
          bol_customer_id: customer.id,
          data_type:       'listings',
          raw_data:        { offers },
          record_count:    offers.length,
          quality_score:   offers.length > 0 ? 1.0 : 0.5,
        }).select('id').single();

        await supabase.from('bol_analyses').insert({
          bol_customer_id: customer.id,
          snapshot_id:     snap?.id ?? null,
          category:        'content',
          score:           analysis.score,
          findings:        analysis.findings,
          recommendations: analysis.recommendations,
        });

        await supabase.from('bol_sync_jobs').update({
          status:       'completed',
          entity_id:    entityId,
          completed_at: new Date().toISOString(),
        }).eq('id', jobId);

        results.push({ jobId, status: 'completed', detail: `${offers.length} offers, content score ${analysis.score}` });

      } else if (status === 'FAILURE') {
        await supabase.from('bol_sync_jobs').update({
          status:       'failed',
          error:        'Bol.com reported FAILURE status',
          completed_at: new Date().toISOString(),
        }).eq('id', jobId);
        results.push({ jobId, status: 'failed', detail: 'Bol.com FAILURE' });

      } else {
        // Still PENDING or IN_PROGRESS — leave it for next cron run
        results.push({ jobId, status: 'pending', detail: `bol.com status: ${status}` });
      }

    } catch (err) {
      const msg = (err as Error).message;
      await supabase.from('bol_sync_jobs').update({ error: msg }).eq('id', jobId);
      results.push({ jobId, status: 'error', detail: msg });
    }
  }

  const completed = results.filter(r => r.status === 'completed').length;
  const pending   = results.filter(r => r.status === 'pending').length;
  console.log(`[bol-sync-complete] checked ${pendingJobs.length} jobs: ${completed} completed, ${pending} still pending — ${Date.now() - startedAt}ms`);

  return res.status(200).json({
    checked:     pendingJobs.length,
    completed,
    still_pending: pending,
    duration_ms: Date.now() - startedAt,
    results,
  });
}
