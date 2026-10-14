import {getDatabaseBackend} from './database.js';
import {getPostgresPool} from './postgres.js';
import {publicData} from './auth.js';

const platforms={entel_b2b:'Entel Empresas B2B',culqi_bcp:'Culqi del BCP',desarrollo_comercial:'Desarrollo Comercial'};
const key=value=>String(value||'').trim().toLowerCase();
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
export function applyUserAccessPatch(users,actor,username,patch){
  if(key(actor?.rol)!=='admin') fail('Solo el Administrador puede modificar accesos.',403);
  if(!Array.isArray(users)) fail('La lista de usuarios no es valida.',500);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) fail('Accesos invalidos.');
  const fields=Object.keys(patch);
  if(!fields.length||fields.some(f=>!['platformAccess','staffingAccess'].includes(f))) fail('Campos de acceso invalidos.');
  if('platformAccess' in patch&&(!Array.isArray(patch.platformAccess)||!patch.platformAccess.length||patch.platformAccess.some(p=>!Object.hasOwn(platforms,p)))) fail('Selecciona plataformas validas.');
  if('staffingAccess' in patch&&typeof patch.staffingAccess!=='boolean') fail('Acceso a Dotacion invalido.');
  const matches=users.filter(u=>key(u.usuario)===key(username));
  if(!matches.length) fail('Usuario no encontrado.',404);
  const next=users.map(user=>{
    if(key(user.usuario)!==key(username))return user;
    const updated={...user,...patch,updatedAt:new Date().toISOString()};
    if(patch.platformAccess){
      updated.platformAccess=[...new Set(patch.platformAccess)];
      updated.clientId=updated.platformId=updated.platformAccess[0];
      updated.clientName=updated.platformName=platforms[updated.clientId];
    }
    return updated;
  });
  return {users:next,user:next.find(u=>key(u.usuario)===key(username))};
}
export async function updateUserAccess(actor,username,patch){
  if(key(actor?.rol)!=='admin') fail('Solo el Administrador puede modificar accesos.',403);
  if(getDatabaseBackend('users_v1')!=='postgres') fail('Este cambio requiere PostgreSQL.',503);
  const db=await getPostgresPool().connect();
  try{
    await db.query('BEGIN');
    const row=(await db.query('SELECT value FROM shared_records WHERE key=$1 FOR UPDATE',['users_v1'])).rows[0];
    if(!row)fail('No se encontro la lista de usuarios.',404);
    const result=applyUserAccessPatch(JSON.parse(row.value),actor,username,patch);
    await db.query('UPDATE shared_records SET value=$1,updated_at=NOW() WHERE key=$2',[JSON.stringify(result.users),'users_v1']);
    await db.query('COMMIT');
    return publicData(result.user);
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
