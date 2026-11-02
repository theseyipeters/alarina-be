import { type InferSchemaType, Schema, model } from 'mongoose'

// A photo of an aso-ebi or wishlist item, kept in the database so no file storage is needed. The
// frontend shrinks photos before uploading, so these stay small. Items point at one by id.
const itemImageSchema = new Schema(
  {
    weddingId: { type: Schema.Types.ObjectId, ref: 'Wedding', required: true, index: true },
    contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
)

export type ItemImageDoc = InferSchemaType<typeof itemImageSchema>
export const ItemImage = model('ItemImage', itemImageSchema)
