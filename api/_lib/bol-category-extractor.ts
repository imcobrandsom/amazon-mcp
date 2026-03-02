/**
 * Helper to extract and normalize category information from Bol.com catalog API responses
 */

export interface CategoryInfo {
  categoryId: string | null; // Bol.com's internal category ID
  categoryPath: string; // "Sport > Sportkleding > Sportlegging"
  categorySlug: string; // "sportlegging" (normalized)
}

/**
 * Extract category information from catalog product data
 *
 * The catalog API structure is not fully documented, so this function
 * attempts multiple possible field names and structures.
 */
export function extractCategory(catalogData: any): CategoryInfo {
  if (!catalogData || typeof catalogData !== 'object') {
    return {
      categoryId: null,
      categoryPath: 'Uncategorized',
      categorySlug: 'uncategorized',
    };
  }

  let categoryId: string | null = null;
  let categoryPath = 'Uncategorized';

  // Extract categoryId from gpc.chunkId (Bol.com's internal category ID)
  if (catalogData.gpc?.chunkId) {
    categoryId = String(catalogData.gpc.chunkId);
  }

  // Extract category from attributes array
  // Look for "Product Group" attribute
  if (catalogData.attributes && Array.isArray(catalogData.attributes)) {
    const productGroupAttr = catalogData.attributes.find(
      (attr: any) => attr.id === 'Product Group'
    );

    if (productGroupAttr?.values?.[0]?.value) {
      categoryPath = productGroupAttr.values[0].value;
    }
  }

  // Fallback: Try other possible structures
  if (categoryPath === 'Uncategorized') {
    if (catalogData.categoryPath && typeof catalogData.categoryPath === 'string') {
      categoryPath = catalogData.categoryPath;
    } else if (catalogData.category_path && typeof catalogData.category_path === 'string') {
      categoryPath = catalogData.category_path;
    } else if (catalogData.category?.path && Array.isArray(catalogData.category.path)) {
      categoryPath = catalogData.category.path.join(' > ');
    } else if (catalogData.categories && Array.isArray(catalogData.categories)) {
      categoryPath = catalogData.categories.map((c: any) => c.name || c).join(' > ');
    } else if (catalogData.category?.name) {
      categoryPath = catalogData.category.name;
    } else if (typeof catalogData.category === 'string') {
      categoryPath = catalogData.category;
    }
  }

  // Generate slug from path (take the last segment, normalize)
  const categorySlug = categoryPath
    .split(' > ')
    .pop()
    ?.toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'uncategorized';

  return {
    categoryId,
    categoryPath,
    categorySlug,
  };
}

/**
 * Extract product list fields from the /retailer/content/products response
 */
export interface ProductListItem {
  ean: string;
  title: string | null;
  brand: string | null;
  listPrice: number | null;
  categoryId: string | null;
}

export function parseProductListItem(item: any): ProductListItem {
  return {
    ean: item.ean || item.EAN || '',
    title: item.title || item.name || null,
    brand: item.brand || item.brandName || null,
    listPrice: item.listPrice || item.price || null,
    categoryId: item.categoryId || item.category_id || null,
  };
}
