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
    const { objectKey } = req.body

    if (!objectKey) {
      return res.status(400).json({ error: 'Missing objectKey' })
    }

    // Download from Fil One
    const result = await s3.getObject({
      Bucket: 'ownerz-v01',
      Key: objectKey,
    }).promise()

    // Parse the encrypted data
    const encryptedData = JSON.parse(result.Body.toString())

    return res.status(200).json({
      success: true,
      encryptedData,
      metadata: result.Metadata,
    })
    
  } catch (err) {
    console.error('[download] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
