import test from 'node:test';
import assert from 'node:assert/strict';
import {applyUserAccessPatch} from '../server/userAccess.js';
const admin={rol:'admin'};
const original=[{usuario:'Adrian',rol:'analista',passwordHash:'unchanged',platformAccess:['entel_b2b'],staffingAccess:false},{usuario:'Other',rol:'asesor'}];
test('independent access edits retain both changes and preserve credentials and other users',()=>{
 const first=applyUserAccessPatch(original,admin,'adrian',{platformAccess:['entel_b2b','culqi_bcp','desarrollo_comercial']});
 const second=applyUserAccessPatch(first.users,admin,'Adrian',{staffingAccess:true});
 assert.equal(second.user.platformAccess.length,3);assert.equal(second.user.staffingAccess,true);
 assert.equal(second.user.passwordHash,'unchanged');assert.equal(second.user.rol,'analista');
 assert.equal(second.users[1],original[1]);
 const revoked=applyUserAccessPatch(second.users,admin,'Adrian',{staffingAccess:false});
 assert.equal(revoked.user.staffingAccess,false);assert.equal(revoked.user.platformAccess.length,3);
 assert.equal(original[0].staffingAccess,false);
});
test('only admin may edit access; delegation does not grant administration',()=>{
 for(const rol of ['asesor','analista','supervisor','coordinador','monitor','formador']) {
  assert.throws(()=>applyUserAccessPatch(original,{rol,staffingAccess:true},'Adrian',{staffingAccess:true}),e=>e.status===403);
 }
});
test('reject malformed patches, privilege changes and unknown users',()=>{
 for(const patch of [{},{rol:'admin'},{platformAccess:[]},{platformAccess:['unknown']},{staffingAccess:'true'}])assert.throws(()=>applyUserAccessPatch(original,admin,'Adrian',patch));
 assert.throws(()=>applyUserAccessPatch(original,admin,'missing',{staffingAccess:true}),e=>e.status===404);
});
