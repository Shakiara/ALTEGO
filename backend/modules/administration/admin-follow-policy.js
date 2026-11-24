// ALTEGO necesita resolver el seguimiento obligatorio de la cuenta Admin.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export const socialListsMigration='024_social_lists';
export async function mainAdminId(sql){
 const [ready]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[socialListsMigration]);if(!ready.length)return null;
 const [[policy]]=await sql.execute('SELECT main_admin_id FROM social_policy WHERE id=1');if(!policy)throw Object.assign(Error('The follow policy is unavailable.'),{status:503});return Number(policy.main_admin_id);
}

export async function ensureRequiredAdminFollow(sql,userId){const admin=await mainAdminId(sql);if(admin&&Number(userId)!==admin)await sql.execute('INSERT INTO creator_follows(follower_id,creator_id) VALUES (?,?) ON DUPLICATE KEY UPDATE creator_id=VALUES(creator_id)',[userId,admin]);}
export async function requiredAdminFollow(sql,actor,target){const admin=await mainAdminId(sql);return !!actor&&Number(actor)!==admin&&Number(target)===admin;}
