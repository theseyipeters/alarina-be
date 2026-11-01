// Invitation designs the couple can pick from. The frontend owns how each one looks
// (fe/src/invite); the API only needs the valid ids. Keep both lists in step.
export const TEMPLATES = ['classic', 'modern', 'editorial'] as const
export const PALETTES = ['ivory', 'sage', 'blush', 'emerald', 'midnight'] as const

export type Template = (typeof TEMPLATES)[number]
export type Palette = (typeof PALETTES)[number]
