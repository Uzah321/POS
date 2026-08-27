// Keyword -> icon lookup for category chips, shared by POSPage and CashierPage.
// Categories are free-text (store-defined), so this matches on common keywords
// rather than requiring an exact name — falls back to a generic icon otherwise.
import {
  Coffee, ChefHat, Croissant, ShoppingBasket, Candy, Milk,
  Wine, Sparkles, Beef, Apple, Package, LayoutGrid, Cigarette, Fish, IceCreamCone,
  Pizza, Sandwich, type LucideIcon,
} from 'lucide-react';

const KEYWORD_ICONS: Array<[string[], LucideIcon]> = [
  [['beverage', 'drink', 'soda', 'soft drink', 'juice'], Coffee],
  [['fast food', 'burger'], Sandwich],
  [['pizza'], Pizza],
  [['restaurant', 'kitchen', 'meal'], ChefHat],
  [['bakery', 'bread', 'pastry'], Croissant],
  [['grocery', 'general'], ShoppingBasket],
  [['confection', 'candy', 'sweet', 'snack'], Candy],
  [['ice cream', 'dessert'], IceCreamCone],
  [['dairy', 'milk', 'cheese', 'yog'], Milk],
  [['alcohol', 'beer', 'wine', 'liquor', 'spirit'], Wine],
  [['tobacco', 'cigarette'], Cigarette],
  [['household', 'cleaning', 'detergent', 'toiletries'], Sparkles],
  [['meat', 'butcher', 'poultry'], Beef],
  [['seafood', 'fish'], Fish],
  [['produce', 'fruit', 'veg'], Apple],
];

export function iconForCategory(name: string): LucideIcon {
  if (!name || name === 'All') return LayoutGrid;
  const lower = name.toLowerCase();
  for (const [keywords, icon] of KEYWORD_ICONS) {
    if (keywords.some((kw) => lower.includes(kw))) return icon;
  }
  return Package;
}
