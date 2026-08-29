export const runtime = 'nodejs'

import s3, { BUCKET, GetObjectCommand } from '../../lib/s3'

async function streamToString(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
  }
  return chunks.join('')
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const key = searchParams.get('key')

    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing key parameter' }), { status: 400 })
    }

    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }))

    const data = await streamToString(result.Body)

    return new Response(JSON.stringify({ success: true, data, key }), { status: 200 })
  } catch (err) {
    console.error('[download-key] Error:', err.name, err.message, err.$metadata?.httpStatusCode)
    const status = err.$metadata?.httpStatusCode || 500
    const msg = err.name === 'NoSuchKey' ? 'Key seed not found in storage' : err.message
    return new Response(JSON.stringify({ error: msg, key }), { status })
  }
}
