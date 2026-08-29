export const runtime = 'nodejs'

import s3, { BUCKET, PutObjectCommand } from '../../lib/s3'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = req.body
    const encryptedData = body.encryptedData || body.data || body.encrypted
    const fileName = body.fileName || body.filename || body.originalName || 'unnamed.enc'
    const sellerAddress = body.sellerAddress || ''
    const price = body.price || '0'

    if (!encryptedData) {
      return res.status(400).json({ error: 'Missing encryptedData or data' })
    }

    const timestamp = Date.now()
    const randomBytes = new Uint8Array(8)
    crypto.getRandomValues(randomBytes)
    const randomId = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    const objectKey = `ownerz/${timestamp}-${randomId}.enc`

    // TLS version: not available in Node.js runtime (was Cloudflare edge only)
    const pqc = false
    const tlsVersion = 'unknown'

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
        'pqc': 'false',
        'tls-version': 'unknown',
      },
    }))

    const cid = objectKey

    return res.status(200).json({
      success: true,
      cid,
      key: objectKey,
      objectKey,
      url: `https://eu-west-1.s3.fil.one/${BUCKET}/${objectKey}`,
      etag: result.ETag,
      fileName,
      sellerAddress: sellerAddress || '',
      price: price || '0',
      pqc,
      tlsVersion,
      message: 'Encrypted file uploaded to Fil One',
    })
  } catch (err) {
    console.error('[upload] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
