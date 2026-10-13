import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const handlers=[...html.matchAll(/  const cambiarContrasenaActual = async\(nuevaContrasena\) => \{[\s\S]*?\n  \};/g)].map(m=>m[0]);
assert.equal(handlers.length,2);
function setup(source, role, response) {
  const currentUser={usuario:'test.user',rol:role,mustChangePassword:true};
  const state={users:[currentUser,{usuario:'unrelated',rol:'asesor'}],calls:[]};
  const context={currentUser,google:{script:{run:{}}},normalizeLoginKey:v=>v.toLowerCase(),
    fetch:async(url,options)=>{state.calls.push({url,options});return response;},
    saveUsers:()=>{throw new Error('Legacy user-list write must not run');},
    loadUsers:()=>{throw new Error('User-list reload must not gate password success');},
    setCurrentUser:user=>{state.user=user;},setUsers:update=>{state.users=update(state.users);},notify:()=>{}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.change=cambiarContrasenaActual;',context);
  return {state,change:context.change};
}
for (const [i,source] of handlers.entries()) {
  for (const role of ['admin','analista','monitor','supervisor','coordinador','asesor','formador']) {
    test(`password handler ${i+1} uses session endpoint with GAS bridge present: ${role}`,async()=>{
      const user={usuario:'test.user',rol:role,mustChangePassword:false};
      const {state,change}=setup(source,role,{ok:true,json:async()=>({ok:true,user})});
      assert.equal(await change('new-test-password'),true);
      assert.equal(state.calls.length,1);
      assert.equal(state.calls[0].url,'/api/auth/password');
      assert.deepEqual(JSON.parse(state.calls[0].options.body),{password:'new-test-password'});
      assert.equal(state.user.passwordChangeRequired,false);
      assert.equal(state.users[0].mustChangePassword,false);
      assert.equal(state.users[1].usuario,'unrelated');
    });
  }
  test(`password handler ${i+1} preserves state and reports API errors`,async()=>{
    const {state,change}=setup(source,'analista',{ok:false,json:async()=>({ok:false,error:'Sesion vencida'})});
    await assert.rejects(change('new-test-password'),/Sesion vencida/);
    assert.equal(state.user,undefined);
    assert.equal(state.users[0].mustChangePassword,true);
  });
}
