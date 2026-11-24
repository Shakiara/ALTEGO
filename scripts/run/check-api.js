// ALTEGO necesita resolver la comprobación HTTP de solo lectura de la API.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import assert from 'node:assert/strict';

const base=process.env.API_URL || 'http://127.0.0.1:3000/api';
async function get(route){
  const response=await fetch(base+route,{signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200,`Unexpected status for ${route}`);
  return response.json();
}
try {
  const health=await get('/health');
  assert.equal(health.mysql,'connected');assert.equal(health.mongodb,'connected');
  const categories=await get('/categories');const products=await get('/products');
  assert.ok(Array.isArray(categories));assert.ok(Array.isArray(products));
  for(const product of products){
    assert.ok(categories.some(c=>c.id===product.category_id));
    assert.equal(typeof product.name,'string');assert.equal(typeof product.price,'number');
    const detail=await get(`/products/${product.id}`);assert.equal(detail.id,product.id);
    const reviews=await get(`/reviews?product_id=${product.id}`);
    assert.ok(reviews.every(r=>r.product_id===product.id&&r.rating>=1&&r.rating<=5));
  }
  console.log(`API checks passed: ${products.length} products, ${categories.length} categories. No data changed.`);
} catch(error){console.error('API checks failed:',error.code || error.cause?.code || error.message);process.exitCode=1;}
