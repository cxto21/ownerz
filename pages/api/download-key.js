import s3, { BUCKET } from '../../lib/s3'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { key } = req.query

    if (!key) {
      return res.status(400).json({ error: 'Missing key parameter' })
    }

    const result = await s3.getObject({
      Bucket: BUCKET,
      Key: key,
    }).promise()

    const data = result.Body.toString('utf-8')

    return res.status(200).json({ success: true, data, key })
  } catch (err) {
    console.error('[download-key] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
