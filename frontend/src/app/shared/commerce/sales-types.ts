// ALTEGO necesita definir los contratos de métricas e historial de ventas.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export interface SalesTotals {ready:boolean;total_revenue_cents:number;total_sales:number;products_sold:number;free_acquisitions:number;currency:string}
export interface SalesOverview extends SalesTotals {timeline:{date:string;through:string;revenue_cents:number}[];interval:string;range:{start:string|null;end:string;timezone:string}}
export interface SalesPerformance {product_id?:number;variant_id?:string;name:string;total_revenue_cents:number;total_sales:number;free_acquisitions:number}
export interface SaleHistory {product_id:number;product_name:string;variant_id:string;variant_name:string;acquired_version_number:number;acquired_at:string;price_cents:number}
export interface SalesPage<T> {items:T[];page:number;pages:number;total:number;size:number}
export interface SalesFilters {period:string;product?:number}
