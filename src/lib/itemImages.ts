import type { Types } from 'mongoose'
import { ItemImage } from '../models/itemImage.js'
import { HttpError } from './httpError.js'

export const MAX_IMAGE_BYTES = 1024 * 1024
export const MAX_IMAGES_PER_WEDDING = 80

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** The image type from the file's own first bytes (never the filename or header), or null if it isn't one we accept. */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/** Throws unless the image exists and belongs to this wedding, so one couple can't attach another's photo. */
export async function assertOwnImage(weddingId: Types.ObjectId, imageId: string) {
  if (!(await ItemImage.exists({ _id: imageId, weddingId }))) {
    throw new HttpError(400, 'That photo wasn’t found. Upload it again.', 'image_not_found')
  }
}

/** Removes a photo that no item uses any more. */
export const deleteImage = (imageId: string | null | undefined) =>
  imageId ? ItemImage.deleteOne({ _id: imageId }) : Promise.resolve()
