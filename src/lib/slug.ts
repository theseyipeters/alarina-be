import { randomInt } from 'node:crypto'

const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

const slugPart = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)

/** e.g. "Ọláolúwa", "Ẹniọlá" → "olaoluwa-and-eniola-k3xp". The suffix keeps same-name couples apart. */
export function makeSlug(a?: string | null, b?: string | null) {
  const base = [slugPart(a), slugPart(b)].filter(Boolean).join('-and-') || 'wedding'
  const suffix = Array.from({ length: 4 }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join('')
  return `${base}-${suffix}`
}
