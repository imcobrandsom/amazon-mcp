/**
 * POST   /api/bol-customers        — create a bol.com customer
 * GET    /api/bol-customers        — list all (secret redacted)
 * PATCH  /api/bol-customers        — update (link client_id, toggle active, etc.)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // ── GET — list customers (no secret returned) ─────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('bol_customers')
      .select(`
        id, seller_name, bol_client_id, ads_client_id, active, sync_interval_hours,
        last_sync_at, created_at, client_id,
        clients ( id, name )
      `)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ customers: data });
  }

  // ── POST — create customer ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      seller_name, bol_client_id, bol_client_secret,
      ads_client_id, ads_client_secret,
      client_id, sync_interval_hours,
    } = req.body ?? {};

    if (!seller_name || !bol_client_id || !bol_client_secret) {
      return res.status(400).json({ error: 'seller_name, bol_client_id and bol_client_secret are required' });
    }

    // ads credentials must be provided together or not at all
    if (!!ads_client_id !== !!ads_client_secret) {
      return res.status(400).json({ error: 'ads_client_id and ads_client_secret must be provided together' });
    }

    const BOL_TOKEN_URL = 'https://login.bol.com/token?grant_type=client_credentials';

    // Verify retailer credentials work before saving
    try {
      const credentials = Buffer.from(`${bol_client_id}:${bol_client_secret}`).toString('base64');
      const tokenRes = await fetch(BOL_TOKEN_URL, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' },
      });
      if (!tokenRes.ok) {
        return res.status(400).json({ error: 'Bol.com retailer credentials are invalid — token request failed' });
      }
    } catch {
      return res.status(400).json({ error: 'Could not reach bol.com to validate retailer credentials' });
    }

    // Verify ads credentials if provided
    if (ads_client_id && ads_client_secret) {
      try {
        const credentials = Buffer.from(`${ads_client_id}:${ads_client_secret}`).toString('base64');
        const tokenRes = await fetch(BOL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' },
        });
        if (!tokenRes.ok) {
          return res.status(400).json({ error: 'Bol.com advertising credentials are invalid — token request failed' });
        }
      } catch {
        return res.status(400).json({ error: 'Could not reach bol.com to validate advertising credentials' });
      }
    }

    const { data, error } = await supabase
      .from('bol_customers')
      .insert({
        seller_name,
        bol_client_id,
        bol_client_secret,
        ads_client_id:     ads_client_id     ?? null,
        ads_client_secret: ads_client_secret ?? null,
        client_id:         client_id         ?? null,
        sync_interval_hours: sync_interval_hours ?? 24,
        active: true,
      })
      .select('id, seller_name, bol_client_id, ads_client_id, active, client_id, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A customer with this bol_client_id already exists' });
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ customer: data });
  }

  // ── PATCH — update customer ───────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, ...updates } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    // ads credentials must be provided together or not at all
    if (!!updates.ads_client_id !== !!updates.ads_client_secret) {
      return res.status(400).json({ error: 'ads_client_id and ads_client_secret must be updated together' });
    }

    // Never allow updating bol_client_id (primary key in bol's system)
    const allowed = ['seller_name', 'bol_client_secret', 'ads_client_id', 'ads_client_secret', 'client_id', 'active', 'sync_interval_hours'];
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const { data, error } = await supabase
      .from('bol_customers')
      .update(filtered)
      .eq('id', id)
      .select('id, seller_name, bol_client_id, active, client_id, sync_interval_hours')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ customer: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
