export const runtime = 'nodejs'

import s3, { BUCKET, PutObjectCommand } from '../../lib/s3'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { key, data } = req.body

    if (!key || !data) {
      return res.status(400).json({ error: 'Missing key or data' })
    }

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: 'text/plain',
    }))

    return res.status(200).json({ success: true, key })
  } catch (err) {
    console.error('[upload-key] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
