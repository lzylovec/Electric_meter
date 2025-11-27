import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import formidable from 'formidable';
import XLSX from 'xlsx';

export const config = {
  api: { bodyParser: false }
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildData(rows) {
  const clean = rows.filter(r => Array.isArray(r) && r.some(v => v !== undefined && v !== null && String(v).trim() !== ''));
  if (clean.length === 0) return null;
  let maxCols = 0; for (const r of clean) { if (r.length > maxCols) maxCols = r.length; }
  if (maxCols < 24) return null;
  const startIdx = maxCols - 24;
  const companies = [];
  for (let i = 1; i < clean.length; i++) {
    const r = clean[i];
    const values = new Array(24).fill(0);
    let hasNum = false;
    for (let j = 0; j < 24; j++) {
      const num = parseFloat(r[startIdx + j]);
      if (!isNaN(num)) { values[j] = num; hasNum = true; }
    }
    if (hasNum) {
      const nameRaw = r[0];
      const nameStr = String(nameRaw === undefined || nameRaw === null ? '' : nameRaw);
      const name = nameStr.replace(/^\ufeff/, '').trim() || `第${i}行`;
      companies.push({ name, values });
    }
  }
  const sums = new Array(24).fill(0);
  for (const c of companies) { for (let j = 0; j < 24; j++) sums[j] += c.values[j]; }
  return { sums, companies };
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return null;
  const rows = [];
  let maxCols = 0;
  for (const line of lines) {
    const cols = line.split(/,|\t|;/).filter(x => x !== '');
    rows.push(cols); if (cols.length > maxCols) maxCols = cols.length;
  }
  return buildData(rows);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const isServerless = !!process.env.VERCEL || !!process.env.NOW_REGION || !!process.env.NETLIFY;
  const uploadDir = os.tmpdir();
  ensureDir(uploadDir);
  const form = formidable({ uploadDir, keepExtensions: true, multiples: false, maxFileSize: 50 * 1024 * 1024 });

  const result = await new Promise((resolve, reject) => {
    form.parse(req, async (err, fields, files) => {
      if (err) { reject(err); return; }
      try {
        const file = files.file || files.upload || Object.values(files)[0];
        if (!file) { resolve({ status: 400, body: { error: 'No file' } }); return; }
        const filepath = Array.isArray(file) ? file[0].filepath : file.filepath;
        const originalName = Array.isArray(file) ? file[0].originalFilename : file.originalFilename;
        const extname = (originalName || filepath) ? path.extname(originalName || filepath).toLowerCase() : '';
        let body = null;
        if (extname === '.xlsx' || extname === '.xls') {
          const buf = fs.readFileSync(filepath);
          const wb = XLSX.read(buf, { type: 'buffer' });
          const months = [];
          for (const wsname of wb.SheetNames) {
            const sheet = wb.Sheets[wsname];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
            const d = buildData(rows);
            if (d) months.push({ name: wsname, ...d });
          }
          if (!months.length) { resolve({ status: 400, body: { error: 'Parse failed' } }); return; }
          body = { filename: originalName, months, sums: months[0].sums, companies: months[0].companies };
        } else {
          const text = fs.readFileSync(filepath, 'utf8');
          const d = parseCsvText(text);
          if (!d) { resolve({ status: 400, body: { error: 'Parse failed' } }); return; }
          const months = [{ name: 'CSV', ...d }];
          body = { filename: originalName, months, sums: months[0].sums, companies: months[0].companies };
        }
        resolve({ status: 200, body });
      } catch (e) {
        reject(e);
      }
    });
  }).catch(e => ({ status: 500, body: { error: String(e && e.message ? e.message : e) } }));

  res.status(result.status).json(result.body);
}
