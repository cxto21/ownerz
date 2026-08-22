export const runtime = 'edge'

import s3, { BUCKET, PutObjectCommand } from '../../lib/s3'

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const body = await req.json()
    // Tolerant: accept {data, encryptedData} and {fileName, fileName fallback}
    const encryptedData = body.encryptedData || body.data || body.encrypted
    const fileName = body.fileName || body.filename || body.originalName || 'unnamed.enc'
    const sellerAddress = body.sellerAddress || ''
    const price = body.price || '0'

    if (!encryptedData) {
      return new Response(JSON.stringify({ error: 'Missing encryptedData or data' }), { status: 400 })
    }

    const timestamp = Date.now()
    const randomBytes = new Uint8Array(8)
    crypto.getRandomValues(randomBytes)
    const randomId = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    const objectKey = `ownerz/${timestamp}-${randomId}.enc`

    const result = await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
      Body: JSON.stringify(encryptedData),
      ContentType: 'application/json',
      Metadata: {
        'original-name': fileName,
        'uploaded-at': new Date().toISOString(),
        'seller-address': sellerAddress || '',
        'price': price || '0',
      },
    }))

    const cid = objectKey

    return new Response(JSON.stringify({
      success: true,
      cid,
      key: objectKey,
      objectKey,
      url: `https://eu-west-1.s3.fil.one/${BUCKET}/${objectKey}`,
      etag: result.ETag,
      fileName,
      sellerAddress: sellerAddress || '',
      price: price || '0',
      message: 'Encrypted file uploaded to Fil One',
    }), { status: 200 })
  } catch (err) {
    console.error('[upload] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
