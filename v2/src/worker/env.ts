export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** '1' — включает вход без Google (/auth/dev). Только в .dev.vars и тестах, в проде не задавать. */
  DEV_LOGIN?: string;
}

export type AppEnv = { Bindings: Env; Variables: { coachId: string } };
