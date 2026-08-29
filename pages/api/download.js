export const runtime = 'nodejs'

import s3, { BUCKET, GetObjectCommand, HeadObjectCommand } from '../../lib/s3'

async function streamToString(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
  }
  return chunks.join('')
}

export default async function handler(req, res) {
  try {
    let objectKey, metadataOnly
    if (req.method === 'GET') {
      objectKey = req.query.cid || req.query.key || req.query.objectKey
      metadataOnly = req.query.metadataOnly === 'true'
    } else if (req.method === 'POST') {
      const body = req.body
      objectKey = body.objectKey || body.cid || body.key
      metadataOnly = body.metadataOnly
    } else {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    if (!objectKey) {
      return res.status(400).json({ error: 'Missing objectKey / cid' })
    }

    if (metadataOnly) {
      const headResult = await s3.send(new HeadObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
      }))

      return res.status(200).json({
        success: true,
        metadata: {
          sellerAddress: headResult.Metadata['seller-address'] || '',
          price: headResult.Metadata['price'] || '0',
          fileName: headResult.Metadata['original-name'] || '',
          uploadedAt: headResult.Metadata['uploaded-at'] || '',
        },
      })
    }

    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
    }))

    const body = await streamToString(result.Body)
    const encryptedData = JSON.parse(body)

    return res.status(200).json({
      success: true,
      encryptedData,
      metadata: {
        sellerAddress: result.Metadata['seller-address'] || '',
        price: result.Metadata['price'] || '0',
        fileName: result.Metadata['original-name'] || '',
      },
    })
  } catch (err) {
    console.error('[download] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
