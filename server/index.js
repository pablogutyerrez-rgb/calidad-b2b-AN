import express from "express";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDashboardInsights } from "./ai.js";
import { config } from "./config.js";
import { installAuth, protectUserWrites } from "./auth.js";
import { getDatabaseBackend, readSharedRecord, readSharedJson } from "./database.js";
import { listEvaluationFolderFiles, uploadEvaluationAttachmentsToDrive, validateDriveConnection } from "./drive.js";
import { getRealtimeDatabaseFileBlob, uploadBufferToRealtimeDatabase } from "./fileBlobs.js";
import { gasHandlers, invalidateFirebaseCache } from "./gasHandlers.js";
import { importStaffing } from "./staffingImport.js";
import { validatePostgresConnection } from "./postgres.js";
import { getFirebaseStorageFileStream, uploadBufferToFirebaseStorage, validateFirebaseStorageConnection } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

const app = express();
let lastFirebaseQuotaLogAt = 0;
installAuth(app, express.json({limit:"1mb"}), () => invalidateFirebaseCache("users_v1"));

app.post("/api/uploads/attachment", express.raw({ type: "application/octet-stream", limit: "80mb" }), async (req, res, next) => {
  try {
    const ownerId = String(req.query.ownerId || "").trim();
    const fileName = String(req.query.fileName || "").trim();
    if (!ownerId || !fileName) {
      res.status(400).json({ ok: false, error: "Faltan ownerId o fileName para subir el adjunto." });
      return;
    }
    const owner = { id: ownerId, type: String(req.query.ownerType || "attachment") };
    const attachment = {
      name: fileName,
      mimeType: String(req.query.mimeType || "application/octet-stream"),
      kind: String(req.query.kind || "attachment")
    };
    if (getDatabaseBackend() === "postgres") {
      const file = await uploadBufferToRealtimeDatabase(owner, attachment, req.body);
      res.json({ ok: true, file });
      return;
    }
    try {
      const file = await uploadBufferToFirebaseStorage(owner, attachment, req.body);
      res.json({ ok: true, file });
    } catch (storageError) {
      console.warn("[ATTACHMENT_STORAGE_FALLBACK]", storageError?.message || storageError);
      const driveResult = await uploadEvaluationAttachmentsToDrive(owner, [{
        ...attachment,
        size: req.body.length,
        base64: req.body.toString("base64")
      }]);
      const file = driveResult.savedFiles?.[0];
      if (!file) {
        const error = new Error(driveResult.driveWarning || "No existe un almacenamiento de archivos disponible.");
        error.status = 503;
        throw error;
      }
      res.json({ ok: true, file, fallback: "google_drive" });
    }
  } catch (error) {
    next(error);
  }
});

app.use(express.json({ limit: "80mb" }));
app.use(express.urlencoded({ extended: true, limit: "80mb" }));

app.post("/api/staffing/import",async(req,res,next) => {
  if (req.authUser.rol !== "admin") return res.status(403).json({ok:false,error:"Solo el Administrador puede importar y crear usuarios."});
  try {
    const result = await importStaffing(req.body);
    if (req.body.commit === true) invalidateFirebaseCache("staffing","users_v1");
    res.json({ok:true,...result});
  } catch(error) { error.status = 400; next(error); }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: "local-node", database: getDatabaseBackend(), timestamp: new Date().toISOString() });
});

app.get("/api/database/validate", async (_req, res) => {
  const postgres = await validatePostgresConnection();
  res.json({ ok: postgres.ok, activeBackend: getDatabaseBackend(), postgres });
});

app.post("/api/ai/dashboard-insights", async (req, res, next) => {
  try {
    res.json(await generateDashboardInsights({
      question: req.body?.question || "",
      context: req.body?.context || {},
      messages: Array.isArray(req.body?.messages) ? req.body.messages : []
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/firebase/shared/:key.json", async (req, res, next) => {
  try {
    const record = await readSharedRecord(req.params.key);
    res.json(record || null);
  } catch (error) {
    next(error);
  }
});

app.get("/api/drive/validate", async (_req, res, next) => {
  try {
    res.json(await validateDriveConnection());
  } catch (error) {
    next(error);
  }
});

app.get("/api/storage/validate", async (_req, res, next) => {
  try {
    res.json(await validateFirebaseStorageConnection());
  } catch (error) {
    next(error);
  }
});

app.get("/api/storage/files/:storagePath/content", async (req, res, next) => {
  try {
    const storagePath = decodeURIComponent(String(req.params.storagePath || "").trim());
    if (!storagePath) {
      res.status(400).json({ ok: false, error: "storagePath requerido." });
      return;
    }
    const { stream, metadata, status } = await getFirebaseStorageFileStream(storagePath, String(req.headers.range || ""));
    const size = Number(metadata.size || 0) || 0;
    const contentType = metadata.contentType || "application/octet-stream";
    res.status(status);
    res.setHeader("content-type", contentType);
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("cache-control", "private, max-age=3600");
    if (status === 206 && req.headers.range && size) {
      const match = String(req.headers.range).match(/bytes=(\d*)-(\d*)/);
      const start = match && match[1] ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : size - 1;
      res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
      res.setHeader("content-length", Math.max(0, end - start + 1));
    } else if (size) {
      res.setHeader("content-length", size);
    }
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/firebase-files/:blobId/content", async (req, res, next) => {
  try {
    const { buffer, metadata } = await getRealtimeDatabaseFileBlob(req.params.blobId);
    const size = buffer.length;
    const range = String(req.headers.range || "");
    res.setHeader("content-type", metadata.mimeType || "application/octet-stream");
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("cache-control", "private, max-age=3600");
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match && match[1] ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || end >= size || start > end) {
        res.status(416).setHeader("content-range", `bytes */${size}`).end();
        return;
      }
      res.status(206);
      res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
      res.setHeader("content-length", end - start + 1);
      res.end(buffer.subarray(start, end + 1));
      return;
    }
    res.setHeader("content-length", size);
    res.end(buffer);
  } catch (error) {
    next(error);
  }
});

app.get("/api/drive/folders/:folderId/files", async (req, res, next) => {
  try {
    res.json({ ok: true, files: await listEvaluationFolderFiles(req.params.folderId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/drive/files/:fileId/content", async (req, res, next) => {
  try {
    const fileId = String(req.params.fileId || "").trim();
    if (!fileId) {
      res.status(400).json({ ok: false, error: "fileId requerido." });
      return;
    }
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).send(await upstream.text());
      return;
    }
    res.status(upstream.status);
    const passthroughHeaders = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"];
    passthroughHeaders.forEach(name => {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    });
    if (!res.getHeader("content-type")) res.setHeader("content-type", "audio/mpeg");
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("cache-control", "private, max-age=3600");
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    next(error);
  }
});

async function handleRpcRequest(req, res, next) {
  try {
    const functionName = req.params.functionName;
    const handler = Object.hasOwn(gasHandlers,functionName) ? gasHandlers[functionName] : null;
    if (!handler) {
      res.status(404).json({ ok: false, error: `Funcion no disponible en backend Node: ${functionName}` });
      return;
    }
    const args = req.body?.args || [];
    if (!Array.isArray(args)) return res.status(400).json({ok:false,error:"Argumentos invalidos."});
    const user = req.authUser;
    if (["saveData","deleteData"].includes(functionName)) {
      const role = String(user.rol || "").toLowerCase();
      const key = args[0];
      const allowed = role === "admin" || (functionName === "saveData" && key === "staffing" && (role === "analista" || user.staffingAccess === true));
      if (!allowed) return res.status(403).json({ok:false,error:"No tienes permisos para modificar esta coleccion directamente."});
      if (key === "users_v1" && functionName === "saveData") {
        const incoming = typeof args[1] === "string" ? JSON.parse(args[1]) : args[1];
        args[1] = JSON.stringify(protectUserWrites(incoming,await readSharedJson("users_v1",[])));
      }
    }
    if (args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
      args[0] = {...args[0],currentUser:user,actorUser:user.usuario,actorName:user.nombre,actorRole:user.rol};
    } else if (!["getData","saveData","deleteData","listData","getEvaluationRecordDetail","getCommunicationFilePreview","getFeedbackFilePreview"].includes(functionName)) {
      args[0] = {currentUser:user};
    }
    if (functionName === "getCalibrationData") args[0] = {...user,clientId:args[0]?.clientId || user.clientId};
    const result = await handler(...args);
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
}

app.post("/api/rpc/:functionName", handleRpcRequest);
app.post("/api/gas/:functionName", handleRpcRequest);

app.use(express.static(publicDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  const quotaError = error?.code === "FIREBASE_QUOTA_EXCEEDED";
  if (!quotaError || Date.now() - lastFirebaseQuotaLogAt >= 60 * 1000) {
    console.error("[LOCAL_API_ERROR]", error);
    if (quotaError) lastFirebaseQuotaLogAt = Date.now();
  }
  res.status(error.status || 500).json({
    ok: false,
    error: error.message || "Error inesperado en API local."
  });
});

app.listen(config.port, () => {
  console.log(`Calidad B2B local: http://localhost:${config.port}`);
  gasHandlers.listFeedbackRecords().catch(error => console.error("[FEEDBACK_SLA_INITIAL_ERROR]", error));
});

const feedbackSlaInterval = setInterval(() => {
  gasHandlers.listFeedbackRecords().catch(error => console.error("[FEEDBACK_SLA_INTERVAL_ERROR]", error));
}, 15 * 60 * 1000);
feedbackSlaInterval.unref();
