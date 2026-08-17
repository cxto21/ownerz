import AWS from 'aws-sdk'

const s3 = new AWS.S3({
  endpoint: process.env.FIL_ONE_ENDPOINT || 'https://eu-west-1.s3.fil.one',
  accessKeyId: process.env.FIL_ONE_ACCESS_KEY_ID,
  secretAccessKey: process.env.FIL_ONE_SECRET_ACCESS_KEY,
  region: process.env.FIL_ONE_REGION || 'eu-west-1',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
})

export const BUCKET = process.env.FIL_ONE_BUCKET || 'ownerz-v01'
export const PREFIX = 'ownerz/'
export default s3
