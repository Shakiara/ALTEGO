// ALTEGO necesita resolver la disponibilidad del esquema sin ejecutar migraciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export const acquisitionMigration = '032_acquisition_foundation';
export async function acquisitionReady(sql) { return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [acquisitionMigration]))[0].length); }
export const adminFoundationMigration = '020_admin_foundation';
export async function adminFoundationReady(sql) {
    const [[row]] = await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [adminFoundationMigration]);
    return Boolean(row);
}
export const governanceMigration = '021_admin_governance';
export async function governanceReady(sql) {
    const [[row]] = await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [governanceMigration]);
    return Boolean(row);
}
export const refinementMigration = '022_admin_refinements';
export async function refinementsReady(sql) { return (await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [refinementMigration]))[0].length === 1; }
export const catalogFiltersMigration = '025_catalog_filters';
export const checkoutMigration = '033_checkout_service';
export async function checkoutReady(sql) { return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [checkoutMigration]))[0].length); }
export const collectionMigration = '036_my_collection';
export async function collectionReady(sql) { return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [collectionMigration]))[0].length); }
export const engagementMigration = '017_conversation_engagement';
export const moderationMigration = '018_conversation_moderation';
export const postsMigration = '016_conversation_posts';
export const creatorCommerceMigration = '029_verified_quota_bag';
export const verificationMigration = '019_creator_verification';
export const favoritesMigration = '023_variant_favorites';
export const followingFeedMigration = '031_following_feed';
export async function followingFeedReady(sql) { return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [followingFeedMigration]))[0].length); }
export const reviewActionsMigration = '035_review_actions';
export async function reviewActionsReady(sql) { return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [reviewActionsMigration]))[0].length); }
export const salesMigration = '034_sales_insights';
export async function salesReady(sql) { return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [salesMigration]))[0].length); }
