// Invitation designs the couple can pick from. The frontend owns how each one looks
// (fe/src/invite); the API only needs the valid ids. Keep both lists in step.
export const TEMPLATES = ['classic', 'modern', 'editorial', 'garden', 'deco', 'adire', 'minimal', 'poster'] as const
export const PALETTES = [
  'ivory',
  'sage',
  'blush',
  'emerald',
  'midnight',
  'terracotta',
  'champagne',
  'lavender',
  'ocean',
  'noir',
  'indigo',
  'wine',
  // The couple's own colours, kept in look.colors.
  'custom',
] as const

// Studio choices. Anything left unset follows the template's own default.
export const NAME_FONTS = ['instrument', 'elorien', 'cormorant', 'noto-display', 'great-vibes', 'ballet', 'unbounded'] as const
export const HEADING_FONTS = ['instrument', 'cormorant', 'noto-display', 'eb-garamond', 'spectral', 'unbounded'] as const
export const BODY_FONTS = ['geist', 'eb-garamond', 'spectral', 'montserrat', 'work-sans', 'nunito-sans'] as const
export const JOINERS = ['amp', 'and', 'plus', 'weds'] as const
export const NAME_CASES = ['as-typed', 'capitals'] as const
export const TEXTURES = ['none', 'paper', 'linen', 'dots', 'glow'] as const
export const CORNERS = ['sharp', 'soft', 'round'] as const
export const FRAMES = ['hairline', 'none', 'double', 'accent'] as const
export const NAME_SCALE = { min: 80, max: 120 } as const

export type Template = (typeof TEMPLATES)[number]
export type Palette = (typeof PALETTES)[number]
