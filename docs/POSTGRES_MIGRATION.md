# Migracion de Firebase a PostgreSQL

## Estado seguro

- PostgreSQL se provisiona e inicializa sin cambiar el backend activo.
- `DATABASE_BACKEND=firebase` mantiene produccion en Firebase.
- El migrador copia cada clave, conserva su fecha y verifica SHA-256.
- Solo despues de una verificacion completa se cambia a `DATABASE_BACKEND=postgres`.

## Migrar

1. Confirmar que Firebase Realtime Database responde sin error de cuota.
2. Ejecutar `node scripts/migrate-firebase-to-postgres.js --phase=N` con `FIREBASE_URL`, `FIREBASE_DATABASE_SECRET` y `DATABASE_URL`.
3. Exigir que `sourceKeys`, `copied` y `verified` coincidan, y que `failures` este vacio.
4. Crear una exportacion o snapshot de PostgreSQL.
5. Agregar la fase validada a `POSTGRES_PHASES` y desplegar. Ejemplo: `POSTGRES_PHASES=1,2`.
6. Usar `DATABASE_BACKEND=postgres` solamente cuando todas las fases esten verificadas.
7. Validar login, usuarios, dotacion, evaluaciones, feedbacks, calibraciones, ventas, incidencias y desarrollo comercial.

## Fases

1. Usuarios, dotacion, leyendas y comunicados.
2. Evaluaciones, detalles, eliminaciones e indices.
3. Feedbacks y volumen estadistico.
4. Incidencias, validaciones, no tipificaciones y variable de calidad.
5. Calibraciones completas.
6. Desarrollo comercial.
7. Chat, notificaciones, snapshots y auditorias secundarias.
8. Archivos historicos guardados como blobs.

## Reversion

Restablecer `DATABASE_BACKEND=firebase` y desplegar. Firebase no se elimina ni se modifica durante la copia.
