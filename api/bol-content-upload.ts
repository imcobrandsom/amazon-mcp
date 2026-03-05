import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';
import * as XLSX from 'xlsx';
import formidable from 'formidable';
import * as fs from 'fs';

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
    // Parse multipart form data with formidable
    const form = formidable({ multiples: false });

    const { fields, files } = await new Promise<{
      fields: formidable.Fields;
      files: formidable.Files;
    }>((resolve, reject) => {
      form.parse(req as any, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    // Extract customerId
    const customerId = Array.isArray(fields.customerId)
      ? fields.customerId[0]
      : fields.customerId;

    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customerId required' });
    }

    // Extract file
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray[0];

    if (!file) {
      return res.status(400).json({ error: 'file required' });
    }

    // Read file buffer
    const fileBuffer = fs.readFileSync(file.filepath);
    const filename = file.originalFilename || 'unknown.xlsx';

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

    // Cleanup temporary file
    try {
      fs.unlinkSync(file.filepath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }

    return res.status(200).json({ uploaded, skipped, errors });
  } catch (error: any) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: error.message ?? 'Upload failed' });
  }
}
