// ALTEGO necesita resolver la validación compartida de datos recibidos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export function id(value) {
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 4294967295 ? number : null;
}
function text(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}
export function productError(body) {
  if (!body || !text(body.name, 120)) return 'Name is required (maximum 120 characters).';
  if (!text(body.description, 5000)) return 'Description is required (maximum 5000 characters).';
  if (!id(body.category_id)) return 'Select a valid category.';
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 99999999.99 || Math.abs(body.price * 100 - Math.round(body.price * 100)) > 0.000001) return 'Price must be zero or positive, with at most two decimal places.';
  if (body.model_url != null && (typeof body.model_url !== 'string' || body.model_url.length > 255 || !/^\/models\/[a-zA-Z0-9_-]+\.glb$/.test(body.model_url))) return 'Model must be a /models/name.glb path or null.';
  return null;
}
export function reviewError(body) {
  if (!body || !id(body.product_id)) return 'Select a valid product.';
  if (!text(body.author, 80)) return 'Author is required (maximum 80 characters).';
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) return 'Rating must be an integer between 1 and 5.';
  if (!text(body.comment, 2000)) return 'Enter a comment of up to 2000 characters.';
  return null;
}
