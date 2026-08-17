export const runtime = 'edge'

import s3, { BUCKET, PutObjectCommand } from '../../lib/s3'
import crypto from 'crypto'

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const { encryptedData, fileName, sellerAddress, price } = await req.json()

    if (!encryptedData || !fileName) {
      return new Response(JSON.stringify({ error: 'Missing encryptedData or fileName' }), { status: 400 })
    }

    const timestamp = Date.now()
    const randomId = crypto.randomBytes(8).toString('hex')
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
      objectKey,
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
