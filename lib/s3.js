import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  endpoint: process.env.FIL_ONE_ENDPOINT || 'https://eu-west-1.s3.fil.one',
  region: process.env.FIL_ONE_REGION || 'eu-west-1',
  credentials: {
    accessKeyId: process.env.FIL_ONE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.FIL_ONE_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true,
})

export const BUCKET = process.env.FIL_ONE_BUCKET || 'ownerz-v01'
export const PREFIX = 'ownerz/'
export { PutObjectCommand, GetObjectCommand, HeadObjectCommand }
export default s3
