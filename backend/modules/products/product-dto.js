// ALTEGO necesita resolver los datos públicos y de gestión de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
const preview = id => id ? '/api/previews/' + id : null;

export const decorateProduct = p => ({ ...p, model_url: preview(p.model_asset_id) || p.model_url || null, variants: (p.variants || []).map(v => ({ ...v, is_default: !!v.is_default, legacy: !!v.legacy, texture_url: preview(v.texture_asset_id) })) });
