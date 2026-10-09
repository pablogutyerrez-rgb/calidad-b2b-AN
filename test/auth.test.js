import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, publicData, protectUserWrites, isAllowedOrigin } from "../server/auth.js";

test("origin validation supports local and Railway HTTPS without trusting forwarded headers", () => {
  const req = (origin, host = "localhost:5174") => ({protocol:"http", headers:{origin,"x-forwarded-host":"attacker.example","x-forwarded-proto":"https"},get:()=>host});
  assert.equal(isAllowedOrigin(req("http://localhost:5174"), {}), true);
  assert.equal(isAllowedOrigin(req("http://localhost:3001"), {}), false);
  const railway = {RAILWAY_PUBLIC_DOMAIN:"quality.up.railway.app"};
  assert.equal(isAllowedOrigin(req("https://quality.up.railway.app", "internal:8080"), railway), true);
  assert.equal(isAllowedOrigin(req("https://attacker.example"), railway), false);
  assert.equal(isAllowedOrigin(req("null"), railway), false);
  assert.equal(isAllowedOrigin(req("http://quality.up.railway.app"), railway), false);
  assert.equal(isAllowedOrigin(req("https://custom.example"), {...railway, PUBLIC_ORIGIN:"https://custom.example/"}), true);
  assert.equal(isAllowedOrigin(req("https://quality.up.railway.app"), {...railway, PUBLIC_ORIGIN:"https://custom.example"}), false);
  assert.equal(isAllowedOrigin(req("https://custom.example"), {PUBLIC_ORIGIN:"invalid"}), false);
});

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
