// Aso-ebi (the wedding material): the couple lists what's on offer and sets the price; guests
// pick a quantity and pay through Paystack like a cash gift. Prices are whole naira in the API
// and kobo in the database.

export const ASO_EBI_UNITS = ['set', 'yard', 'piece'] as const
export type AsoEbiUnit = (typeof ASO_EBI_UNITS)[number]

export const MAX_ITEMS = 10
export const MIN_PRICE_NAIRA = 500
// With MAX_QUANTITY this keeps a single order within the largest payment we accept (MAX_GIFT).
export const MAX_PRICE_NAIRA = 250_000
export const MAX_QUANTITY = 20
