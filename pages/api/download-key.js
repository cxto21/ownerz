export const runtime = 'nodejs'

import s3, { BUCKET, GetObjectCommand } from '../../lib/s3'

async function streamToString(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
  }
  return chunks.join('')
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const key = req.query.key

    if (!key) {
      return res.status(400).json({ error: 'Missing key parameter' })
    }

    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }))

    const data = await streamToString(result.Body)

    return res.status(200).json({ success: true, data, key })
  } catch (err) {
    console.error('[download-key] Error:', err.name, err.message, err.$metadata?.httpStatusCode)
    const status = err.$metadata?.httpStatusCode || 500
    const msg = err.name === 'NoSuchKey' ? 'Key seed not found in storage' : err.message
    return res.status(status).json({ error: msg })
  }
}
