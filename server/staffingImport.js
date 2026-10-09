import { getDatabaseBackend } from "./database.js";
import { ensurePostgresSchema, getPostgresPool } from "./postgres.js";
import { hashPassword, publicData } from "./auth.js";

const platforms = {entel_b2b:"Entel Empresas B2B",culqi_bcp:"Culqi del BCP",desarrollo_comercial:"Desarrollo Comercial"};
const key = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
const text = value => String(value ?? "").trim();

export function prepareStaffingImport(payload, staffing, users) {
  if (!Array.isArray(staffing) || !Array.isArray(users)) throw new Error("La estructura de Dotacion o Usuarios no es valida.");
  const {platformId,campaign,rows} = payload;
  if (!platforms[platformId]) throw new Error("Selecciona una plataforma valida.");
  if (!text(campaign) || (platformId === "entel_b2b" && !["RUC 10","RUC 20"].includes(campaign))) throw new Error("Selecciona la campana de destino.");
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error("El Excel debe contener entre 1 y 5000 filas.");
  const nextStaffing = staffing.map(item => ({...item}));
  const nextUsers = users.map(item => ({...item}));
  const preview = [];
  const seen = new Set();
  for (let index=0; index<rows.length; index++) {
    const row = Object.fromEntries(Object.entries(rows[index]).map(([name,value]) => [key(name),text(value)]));
    const names = row.nombres || row.nombre;
    const surnames = row.apellidos || row.apellido;
    const dni = /^\d{1,8}$/.test(row.dni || "") ? row.dni.padStart(8,"0") : row.dni;
    const fail = message => { throw new Error(`Fila ${index+2}: ${message}`); };
    if (!names || !surnames || !/^\d{8}$/.test(dni || "")) fail("Nombres, Apellidos y DNI de 8 digitos son obligatorios.");
    if (row.perfil && !["asesor","ejecutivo"].includes(key(row.perfil))) fail("Esta importacion admite perfiles de asesor.");
    if (seen.has(dni)) fail("DNI repetido dentro del archivo.");
    seen.add(dni);
    const asesor = `${names} ${surnames}`.toUpperCase();
    const existing = nextStaffing.find(item => (item.clientId || item.platformId || "entel_b2b") === platformId && (text(item.dni) === dni || key(item.asesor) === key(asesor)));
    if (existing && text(existing.dni) !== dni) fail("El nombre ya existe con otro DNI; revisa el registro antes de importar.");
    let account = nextUsers.find(item => text(item.dni) === dni || (existing?.usuarioAsignado && key(item.usuario) === key(existing.usuarioAsignado)) || (item.rol === "asesor" && key(item.assessorName || item.nombre) === key(asesor)));
    if (account && (account.rol !== "asesor" || (account.dni && text(account.dni) !== dni))) fail("El asesor coincide con una cuenta de identidad o perfil diferente.");
    if (existing) {
      preview.push({asesor,dni,usuario:existing.usuarioAsignado || account?.usuario || "",accion:"Ya existe; sin cambios"});
      continue;
    }
    const tag = {clientId:platformId,platformId,clientName:platforms[platformId],platformName:platforms[platformId]};
    const createdAt = new Date().toISOString();
    const isNewUser = !account;
    if (!account) {
      const part = value => { const result = key(value).split(/\s+/)[0].replace(/[^a-z0-9]/g,""); return result.charAt(0).toUpperCase()+result.slice(1); };
      const base = `${part(names)}.${part(surnames)}`;
      if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(base)) fail("No se puede generar un usuario con ese nombre.");
      let usuario = base;
      let suffix = 2;
      while (nextUsers.some(item => key(item.usuario) === key(usuario))) usuario = base+suffix++;
      account = {id:usuario,usuario,nombre:asesor,assessorName:asesor,dni,rol:"asesor",estado:"activo",platformAccess:[platformId],campaign,area:platforms[platformId],mustChangePassword:true,createdAt,...tag};
      nextUsers.push(account);
    } else {
      const access = Array.isArray(account.platformAccess) ? account.platformAccess : [account.clientId || account.platformId || "entel_b2b"];
      account.platformAccess = [...new Set([...access,platformId])];
    }
    nextStaffing.push({asesor,dni,supervisor:row.supervisor || "",coordinador:row.coordinador || "",estado:account.estado || "activo",tipoGestionRuc:campaign,campaign,antiguedad:0,usuarioAsignado:account.usuario,createdAt,...tag});
    preview.push({asesor,dni,usuario:account.usuario,accion:isNewUser ? "Crear asesor y usuario" : "Crear asesor; conservar usuario"});
  }
  return {staffing:nextStaffing,users:nextUsers,preview,added:nextStaffing.length-staffing.length};
}

export async function importStaffing(payload) {
  if (getDatabaseBackend() !== "postgres") throw new Error("Esta importacion requiere PostgreSQL activo.");
  await ensurePostgresSchema();
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO shared_records(key,value) VALUES ('staffing','[]'),('users_v1','[]') ON CONFLICT DO NOTHING");
    const result = await client.query("SELECT key,value FROM shared_records WHERE key IN ('staffing','users_v1') ORDER BY key FOR UPDATE");
    const data = Object.fromEntries(result.rows.map(row => [row.key,JSON.parse(row.value)]));
    const next = prepareStaffingImport(payload,data.staffing,data.users_v1);
    if (payload.commit === true) {
      for (const user of next.users) if (!data.users_v1.some(old => key(old.usuario) === key(user.usuario))) user.passwordHash = hashPassword(user.dni);
      for (const [name,value] of [["staffing",next.staffing],["users_v1",next.users]]) await client.query("UPDATE shared_records SET value=$2,updated_at=NOW() WHERE key=$1",[name,JSON.stringify(value)]);
      await client.query("COMMIT");
      return {added:next.added,preview:next.preview,staffing:next.staffing,users:publicData(next.users)};
    }
    await client.query("ROLLBACK");
    return {added:next.added,preview:next.preview};
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
