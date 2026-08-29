export const runtime = 'nodejs'

import s3, { BUCKET, PutObjectCommand } from '../../lib/s3'

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const { key, data } = await req.json()

    if (!key || !data) {
      return new Response(JSON.stringify({ error: 'Missing key or data' }), { status: 400 })
    }

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: 'text/plain',
    }))

    return new Response(JSON.stringify({ success: true, key }), { status: 200 })
  } catch (err) {
    console.error('[upload-key] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
