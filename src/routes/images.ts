import express, { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import { HttpError } from '../lib/httpError.js'
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_WEDDING, sniffImage } from '../lib/itemImages.js'
import { requireAuth } from '../middleware/auth.js'
import { requireGiftsUnlocked } from '../middleware/giftsUnlocked.js'
import { ItemImage } from '../models/itemImage.js'
import { ownWedding } from './gifts.js'
import { imageUploadLimiter } from '../middleware/rateLimit.js'

// Couples upload a photo first, then attach its id to an item when saving the item.
export const imagesRouter = Router()

imagesRouter.post(
  '/gifts/images',
  requireAuth,
  requireGiftsUnlocked,
  imageUploadLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    const bytes = req.body as unknown
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new HttpError(415, 'Upload a JPG, PNG or WebP photo', 'unsupported_image')
    }
    // Trust the bytes, not the header: the file must really be the type it claims to be.
    const type = sniffImage(bytes)
    if (!type) throw new HttpError(415, 'Upload a JPG, PNG or WebP photo', 'unsupported_image')

    const wedding = await ownWedding(req.auth!.user.coupleId)
    if ((await ItemImage.countDocuments({ weddingId: wedding._id })) >= MAX_IMAGES_PER_WEDDING) {
      throw new HttpError(409, 'You’ve reached the photo limit. Remove some items first.', 'too_many_images')
    }
    const image = await ItemImage.create({ weddingId: wedding._id, contentType: type, data: bytes })
    res.status(201).json({ id: String(image._id) })
  },
)

// Guests' browsers load these in <img> tags. An id never changes what it points to, so they cache for good.
export const publicImagesRouter = Router()

publicImagesRouter.get('/images/:id', async (req, res) => {
  const id = String(req.params.id)
  const image = isValidObjectId(id) ? await ItemImage.findById(id) : null
  if (!image) throw new HttpError(404, 'Photo not found', 'image_not_found')
  res.set({
    'Content-Type': image.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    // The frontend is on another origin, and helmet's default would stop it from showing the photo.
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  res.send(image.data)
})
