import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readSharedJson, writeSharedRecord } from "./database.js";

const sessions = new Map();
const attempts = new Map();
const cookieName = "calidad_session";
const secretFields = new Set(["password", "passwordHash", "contrasena", "clave"]);
const loginKey = value => String(value || "").trim().toLowerCase();
const active = user => !["cesado","inactivo","inactive","baja","disabled","bloqueado"].includes(loginKey(user?.estado));
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(String(password), salt, 64).toString("hex")}`;
}
export function verifyPassword(password, user) {
  if (user.passwordHash) {
    const [scheme,salt,hash] = user.passwordHash.split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash,"hex");
    const actual = scryptSync(String(password),salt,64);
    return expected.length === actual.length && timingSafeEqual(expected,actual);
  }
  const expected = Buffer.from(String(user.password || user.contrasena || user.clave || ""));
  const actual = Buffer.from(String(password));
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected,actual);
}
export function publicData(value) {
  if (Array.isArray(value)) return value.map(publicData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretFields.has(key)).map(([key,item]) => {
    if (key === "value" && typeof item === "string") {
      try { return [key,JSON.stringify(publicData(JSON.parse(item)))]; } catch { /* Non-JSON record. */ }
    }
    return [key,publicData(item)];
  }));
}
export function protectUserWrites(incoming, existing) {
  if (!Array.isArray(incoming)) throw new Error("La lista de usuarios no es valida.");
  return incoming.map(user => {
    const previous = existing.find(item => loginKey(item.usuario) === loginKey(user.usuario));
    const password = String(user.password || user.contrasena || user.clave || "").trim();
    const clean = publicData(user);
    const passwordHash = password ? hashPassword(password) : previous?.passwordHash || (previous ? hashPassword(previous.password || previous.contrasena || previous.clave || "") : "");
    if (!passwordHash) throw new Error("Falta la contrasena inicial del usuario.");
    return {...clean,passwordHash};
  });
}
function token(req) {
  return String(req.headers.cookie || "").split(";").map(item => item.trim()).find(item => item.startsWith(cookieName+"="))?.slice(cookieName.length+1);
}
export function installAuth(app, jsonParser, onUsersChanged = () => {}) {
  app.use("/api", (req,res,next) => {
    if (!["GET","HEAD"].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ok:false,error:"Origen no permitido."});
    next();
  });
  app.post("/api/auth/login", jsonParser, async(req,res,next) => {
    try {
      const key = `${req.ip}:${loginKey(req.body?.usuario)}`;
      const attempt = attempts.get(key);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10) return res.status(429).json({ok:false,error:"Demasiados intentos. Espera 15 minutos."});
      const users = await readSharedJson("users_v1",[]);
      const user = users.find(item => loginKey(item.usuario) === loginKey(req.body?.usuario));
      if (!user || !active(user) || !verifyPassword(req.body?.password || "",user)) {
        attempts.set(key,{count:attempt?.until > Date.now() ? attempt.count+1 : 1,until:Date.now()+900000});
        return res.status(401).json({ok:false,error:"Usuario o contrasena incorrectos, o usuario inactivo."});
      }
      attempts.delete(key);
      if (!user.passwordHash) {
        const next = {...publicData(user),passwordHash:hashPassword(req.body.password)};
        await writeSharedRecord("users_v1",users.map(item => item === user ? next : item));
        onUsersChanged();
      }
      for (const [id,session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
      const id = randomBytes(32).toString("hex");
      sessions.set(id,{usuario:user.usuario,expires:Date.now()+8*3600000});
      res.cookie(cookieName,id,{httpOnly:true,sameSite:"strict",secure:req.secure,maxAge:8*3600000,path:"/"});
      res.json({ok:true,user:publicData(user)});
    } catch(error) { next(error); }
  });
  app.post("/api/auth/logout",(req,res) => {
    sessions.delete(token(req));
    res.clearCookie(cookieName,{path:"/"});
    res.json({ok:true});
  });
  app.use("/api",async(req,res,next) => {
    if (req.path === "/health") return next();
    try {
      const session = sessions.get(token(req));
      if (!session || session.expires < Date.now()) return res.status(401).json({ok:false,error:"Inicia sesion para continuar."});
      const users = await readSharedJson("users_v1",[]);
      const user = users.find(item => loginKey(item.usuario) === loginKey(session.usuario));
      if (!user || !active(user)) return res.status(401).json({ok:false,error:"Sesion no disponible."});
      req.authUser = publicData(user);
      const sendJson = res.json.bind(res);
      res.json = body => sendJson(publicData(body));
      next();
    } catch(error) { next(error); }
  });
  app.get("/api/auth/session",(req,res) => res.json({ok:true,user:req.authUser}));
  app.post("/api/auth/password",jsonParser,async(req,res,next) => {
    try {
      const password = String(req.body?.password || "").trim();
      if (password.length < 6) return res.status(400).json({ok:false,error:"Usa al menos 6 caracteres."});
      const users = await readSharedJson("users_v1",[]);
      let updated;
      const nextUsers = users.map(user => {
        if (loginKey(user.usuario) !== loginKey(req.authUser.usuario)) return user;
        updated = {...publicData(user),passwordHash:hashPassword(password),mustChangePassword:false,forcePasswordChange:false,requirePasswordChange:false,passwordChangedAt:new Date().toISOString()};
        return updated;
      });
      await writeSharedRecord("users_v1",nextUsers);
      onUsersChanged();
      res.json({ok:true,user:updated});
    } catch(error) { next(error); }
  });
}
