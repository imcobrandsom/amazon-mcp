import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';
import * as XLSX from 'xlsx';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createAdminClient();

  try {
    // Parse multipart form data manually
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Extract customerId and file from multipart data
    const boundary = req.headers['content-type']?.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ error: 'Invalid multipart request' });
    }

    const parts = buffer.toString('binary').split(`--${boundary}`);
    let customerId: string | null = null;
    let fileBuffer: Buffer | null = null;
    let filename: string | null = null;

    for (const part of parts) {
      if (part.includes('name="customerId"')) {
        const match = part.split('\r\n\r\n')[1]?.split('\r\n')[0];
        if (match) customerId = match;
      } else if (part.includes('name="file"')) {
        const filenameMatch = part.match(/filename="([^"]+)"/);
        if (filenameMatch) filename = filenameMatch[1];

        const dataStart = part.indexOf('\r\n\r\n') + 4;
        const dataEnd = part.lastIndexOf('\r\n');
        if (dataStart > 3 && dataEnd > dataStart) {
          const binaryData = part.substring(dataStart, dataEnd);
          fileBuffer = Buffer.from(binaryData, 'binary');
        }
      }
    }

    if (!customerId) {
      return res.status(400).json({ error: 'customerId required' });
    }
    if (!fileBuffer || !filename) {
      return res.status(400).json({ error: 'file required' });
    }

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
          source_filename: filename,
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
