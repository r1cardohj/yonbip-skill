import sql from "mssql";
import { activeProfile, type Profile } from "./config.ts";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number[];
}

async function connect(p: Profile, timeoutMs: number): Promise<sql.ConnectionPool> {
  return sql.connect({
    server: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,
    options: {
      encrypt: p.encrypt ?? false,
      trustServerCertificate: p.trustServerCertificate ?? true,
    },
    connectionTimeout: Math.min(timeoutMs, 30000),
    requestTimeout: timeoutMs,
  });
}

export async function runQuery(sqlText: string, timeoutMs = 60000): Promise<QueryResult> {
  const p = activeProfile();
  const pool = await connect(p, timeoutMs);
  try {
    const req = pool.request();
    const res = await req.query(sqlText);
    const recordset = Array.isArray(res.recordset) ? res.recordset : [];
    const columns = recordset.length
      ? Object.keys(recordset[0])
      : res.recordset?.columns
        ? Object.keys(res.recordset.columns)
        : [];
    const rows = recordset.map((r) => columns.map((c) => (r as Record<string, unknown>)[c]));
    return { columns, rows, rowsAffected: res.rowsAffected as number[] };
  } finally {
    await pool.close();
  }
}
