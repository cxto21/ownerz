import AWS from 'aws-sdk'

// Fil One S3 client
const s3 = new AWS.S3({
  endpoint: 'https://eu-west-1.s3.fil.one',
  region: 'eu-west-1',
  accessKeyId: process.env.FIL_ONE_ACCESS_KEY_ID,
  secretAccessKey: process.env.FIL_ONE_SECRET_ACCESS_KEY,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { objectKey, metadataOnly } = req.body

    if (!objectKey) {
      return res.status(400).json({ error: 'Missing objectKey' })
    }

    // Metadata-only mode: fetch S3 head (no body download)
    if (metadataOnly) {
      const headResult = await s3.headObject({
        Bucket: 'ownerz-v01',
        Key: objectKey,
      }).promise()

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

    // Full download: encrypted data + metadata
    const result = await s3.getObject({
      Bucket: 'ownerz-v01',
      Key: objectKey,
    }).promise()

    // Parse the encrypted data
    const encryptedData = JSON.parse(result.Body.toString())

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
