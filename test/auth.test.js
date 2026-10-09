import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, publicData, protectUserWrites } from "../server/auth.js";

test("passwords use salted hashes and reject incorrect credentials",()=>{
  const passwordHash = hashPassword("12345678");
  assert.ok(verifyPassword("12345678",{passwordHash}));
  assert.equal(verifyPassword("incorrect",{passwordHash}),false);
  assert.notEqual(passwordHash,hashPassword("12345678"));
  assert.ok(verifyPassword("legacy",{password:"legacy"}));
});
test("API removes credentials from user lists and serialized records",()=>{
  const result = publicData({users:[{usuario:"a",password:"secret",passwordHash:"secret"}],record:{value:JSON.stringify([{clave:"secret",nombre:"A"}])}});
  assert.equal(JSON.stringify(result).includes("secret"),false);
  assert.equal(result.users[0].usuario,"a");
});
test("editing public user data preserves the existing password",()=>{
  const original = {usuario:"a",passwordHash:hashPassword("existing")};
  const [updated] = protectUserWrites([{usuario:"a",password:"",nombre:"Changed"}],[original]);
  assert.equal(updated.passwordHash,original.passwordHash);
  assert.equal(updated.nombre,"Changed");
});
