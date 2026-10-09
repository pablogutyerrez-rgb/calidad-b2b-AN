import test from "node:test";
import assert from "node:assert/strict";
import { prepareStaffingImport } from "../server/staffingImport.js";
const payload = {platformId:"entel_b2b",campaign:"RUC 10",rows:[{Nombres:"Jose Luis",Apellidos:"Perez Ruiz",DNI:"01234567",Perfil:"asesor"}]};
test("import links advisor and user, preserving DNI and campaign",()=>{
  const result = prepareStaffingImport(payload,[],[]);
  assert.equal(result.users[0].usuario,"Jose.Perez");
  assert.equal(result.users[0].mustChangePassword,true);
  assert.equal(result.staffing[0].dni,"01234567");
  assert.equal(result.staffing[0].usuarioAsignado,result.users[0].usuario);
  assert.equal(result.staffing[0].campaign,"RUC 10");
});
test("reimport does not duplicate rows or reset existing passwords",()=>{
  const first = prepareStaffingImport(payload,[],[]);
  first.users[0].passwordHash="unchanged";
  const second = prepareStaffingImport(payload,first.staffing,first.users);
  assert.equal(second.added,0);
  assert.equal(second.users.length,1);
  assert.equal(second.users[0].passwordHash,"unchanged");
});
test("same name on different people gets a distinct login",()=>{
  const result = prepareStaffingImport(payload,[],[{usuario:"Jose.Perez",nombre:"Otra persona",dni:"99999999",rol:"asesor"}]);
  assert.equal(result.users[1].usuario,"Jose.Perez2");
});
test("invalid rows, roles and campaigns are rejected before writing",()=>{
  for (const change of [{DNI:"bad"},{Perfil:"admin"},{Nombres:""}]) assert.throws(()=>prepareStaffingImport({...payload,rows:[{...payload.rows[0],...change}]},[],[]));
  assert.throws(()=>prepareStaffingImport({...payload,campaign:""},[],[]));
  assert.throws(()=>prepareStaffingImport({...payload,rows:[...payload.rows,...payload.rows]},[],[]));
});
test("import into Culqi preserves unrelated Entel records",()=>{
  const existing={asesor:"Otro",dni:"99999999",clientId:"entel_b2b"};
  const result=prepareStaffingImport({...payload,platformId:"culqi_bcp",campaign:"POS"},[existing],[]);
  assert.deepEqual(result.staffing[0],existing);
  assert.deepEqual(result.users[0].platformAccess,["culqi_bcp"]);
});
