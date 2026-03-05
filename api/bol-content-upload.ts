import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';
import * as XLSX from 'xlsx';

// Enable body parsing for JSON
export const config = {
  api: {
    bodyParser: true,
    bodyLimit: '10mb',
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createAdminClient();

  try {
    // Expect JSON body with base64 encoded file
    const { customerId, fileData, filename } = req.body;

    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customerId required' });
    }

    if (!fileData || typeof fileData !== 'string') {
      return res.status(400).json({ error: 'fileData (base64) required' });
    }

    // Decode base64 to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');
    const actualFilename = filename || 'unknown.xlsx';

    // Parse Excel
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ error: 'Excel file has no sheets' });
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<{
      EAN?: string;
      SKU?: string;
      Title?: string;
      Description?: string;
    }>(sheet);

    let uploaded = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const ean = row.EAN?.toString().trim();
      if (!ean) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from('bol_content_base').upsert(
        {
          bol_customer_id: customerId,
          ean,
          sku: row.SKU?.toString().trim() ?? null,
          title: row.Title?.trim() ?? null,
          description: row.Description?.trim() ?? null,
          source_filename: actualFilename,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'bol_customer_id,ean' }
      );

      if (error) {
        errors.push(`EAN ${ean}: ${error.message}`);
        skipped++;
      } else {
        uploaded++;
      }
    }

    return res.status(200).json({ uploaded, skipped, errors });
  } catch (error: any) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: error.message ?? 'Upload failed' });
  }
}
