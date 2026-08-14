import AWS from 'aws-sdk'
import crypto from 'crypto'

// Fil One S3 client (v2 SDK - reliable path-style support)
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
    const { encryptedData, fileName } = req.body

    if (!encryptedData || !fileName) {
      return res.status(400).json({ error: 'Missing encryptedData or fileName' })
    }

    // Generate unique key for Fil One
    const timestamp = Date.now()
    const randomId = crypto.randomBytes(8).toString('hex')
    const objectKey = `datavault/${timestamp}-${randomId}.enc`

    // Upload ONLY encrypted data to Fil One
    // Server never sees unencrypted content
    const uploadResult = await s3.upload({
      Bucket: 'ownerz-v01',
      Key: objectKey,
      Body: JSON.stringify(encryptedData),
      ContentType: 'application/json',
      Metadata: {
        'original-name': fileName,
        'uploaded-at': new Date().toISOString(),
      },
    }).promise()

    const cid = objectKey // Use objectKey as CID so they match

    return res.status(200).json({
      success: true,
      cid,
      objectKey,
      s3Location: uploadResult.Location,
      fileName,
      message: 'Encrypted file uploaded to Fil One',
    })
    
  } catch (err) {
    console.error('[upload] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
