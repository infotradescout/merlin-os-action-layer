const MENU_KEYWORDS = [
  'wings',
  'burger',
  'fries',
  'plate',
  'basket',
  'meal',
  'sandwich',
  'shrimp',
  'chicken',
  'catfish',
  'ribs',
  'drink',
  'sauce',
  'combo',
  'combos',
  'appetizers',
  'entrees',
  'specials',
  'sides',
  'desserts',
  'pcs',
  'pieces',
  'oz',
  'lb',
  'grilled',
  'fried',
  'smoked',
  'loaded',
  'honey',
  'garlic',
  'spicy'
];

const BUSINESS_HINTS = ['truck', 'bbq', 'kitchen', 'catering', 'grill', 'food'];

export function isMenuLikeTruckName(candidate: string | undefined): boolean {
  const name = (candidate || '').trim();
  if (!name) return false;
  const lower = name.toLowerCase();

  const hasPrice = /\$\s?\d{1,3}(?:\.\d{2})?\b|\b\d{1,3}\.\d{2}\b/.test(lower);
  const hasQuantity = /\b\d{1,2}\s*(wings?|pcs?|pieces?|oz|lb)\b/.test(lower);
  const hasMenuToken = MENU_KEYWORDS.some((token) => lower.includes(token));
  const hasFoodWord = /\b(taco|tacos|wings?|burger|fries|shrimp|chicken|catfish|ribs?)\b/.test(lower);
  const wordCount = name.split(/\s+/).filter(Boolean).length;
  const hasBusinessHint = BUSINESS_HINTS.some((token) => lower.includes(token));
  const longMenuLike = name.length > 40 && (hasMenuToken || hasPrice || hasQuantity);

  if (hasBusinessHint && !hasPrice && !hasQuantity) {
    return false;
  }
  if (hasPrice || hasQuantity) return true;
  if (longMenuLike) return true;
  if (hasMenuToken && !hasBusinessHint) return true;
  if (hasFoodWord && !hasBusinessHint && wordCount >= 5) return true;
  return false;
}
