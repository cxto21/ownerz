export const runtime = 'edge'

import s3, { BUCKET, GetObjectCommand, HeadObjectCommand } from '../../lib/s3'

async function streamToString(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
  }
  return chunks.join('')
}

export default async function handler(req) {
  try {
    let objectKey, metadataOnly
    if (req.method === 'GET') {
      const { searchParams } = new URL(req.url)
      objectKey = searchParams.get('cid') || searchParams.get('key') || searchParams.get('objectKey')
      metadataOnly = searchParams.get('metadataOnly') === 'true'
    } else if (req.method === 'POST') {
      const body = await req.json()
      objectKey = body.objectKey || body.cid || body.key
      metadataOnly = body.metadataOnly
    } else {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    if (!objectKey) {
      return new Response(JSON.stringify({ error: 'Missing objectKey / cid' }), { status: 400 })
    }

    if (metadataOnly) {
      const headResult = await s3.send(new HeadObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
      }))

      return new Response(JSON.stringify({
        success: true,
        metadata: {
          sellerAddress: headResult.Metadata['seller-address'] || '',
          price: headResult.Metadata['price'] || '0',
          fileName: headResult.Metadata['original-name'] || '',
          uploadedAt: headResult.Metadata['uploaded-at'] || '',
        },
      }), { status: 200 })
    }

    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
    }))

    const body = await streamToString(result.Body)
    const encryptedData = JSON.parse(body)

    return new Response(JSON.stringify({
      success: true,
      encryptedData,
      metadata: {
        sellerAddress: result.Metadata['seller-address'] || '',
        price: result.Metadata['price'] || '0',
        fileName: result.Metadata['original-name'] || '',
      },
    }), { status: 200 })
  } catch (err) {
    console.error('[download] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
