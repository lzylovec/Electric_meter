import fs from 'node:fs';
import path from 'node:path';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return }
  try {
    const uploadDir = path.join(process.cwd(), 'uploads');
    let cleared = 0;
    if (fs.existsSync(uploadDir)) {
      const items = fs.readdirSync(uploadDir);
      for (const name of items) {
        const fp = path.join(uploadDir, name);
        try {
          const st = fs.statSync(fp);
          if (st.isFile()) { fs.unlinkSync(fp); cleared++ }
        } catch {}
      }
    }
    res.status(200).json({ cleared })
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) })
  }
}
