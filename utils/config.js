import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().optional(),
  WARMUP_ON_START: z.string().optional(),

  ALTEGIO_COMPANY_ID: z.coerce.number().int().positive(),
  ALTEGIO_STORAGE_ID: z.coerce.number().int().positive(),
  ALTEGIO_TOKEN: z.string().min(1),
  ALTEGIO_USER_TOKEN: z.string().min(1),

  SF_API_VERSION: z.string().min(1),
  SF_DOMAIN: z.string().min(1),
  SF_ADMIN_ACCESS_TOKEN: z.string().min(1),
  SF_CONST_LOCATION_ID: z.string().min(1),

  BASIC_AUTH_USER: z.string().optional(),
  BASIC_AUTH_PASS: z.string().optional(),

  IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().optional(),
  QUEUE_BACKOFF_BASE_MS: z.coerce.number().int().positive().optional(),
});

const envWithFallbacks = {
  ...process.env,
  ALTEGIO_TOKEN: process.env.ALTEGIO_TOKEN ?? process.env.ALTEGION_TOKEN,
  ALTEGIO_USER_TOKEN: process.env.ALTEGIO_USER_TOKEN ?? process.env.ALTEGION_USER_TOKEN,
};

const env = envSchema.parse(envWithFallbacks);

export const CONFIG = {
  server: {
    port: env.PORT ?? 3000,
    warmupOnStart: env.WARMUP_ON_START === 'true',
  },
  altegio: {
    companyId: env.ALTEGIO_COMPANY_ID,
    storageId: env.ALTEGIO_STORAGE_ID,
    partnerToken: env.ALTEGIO_TOKEN,
    userToken: env.ALTEGIO_USER_TOKEN,
  },
  shopify: {
    apiVersion: env.SF_API_VERSION,
    domain: env.SF_DOMAIN,
    adminAccessToken: env.SF_ADMIN_ACCESS_TOKEN,
    locationId: env.SF_CONST_LOCATION_ID,
  },
  webhook: {
    idempotencyTtlMs: env.IDEMPOTENCY_TTL_MS ?? 5 * 60 * 1000,
  },
  queue: {
    backoffBaseMs: env.QUEUE_BACKOFF_BASE_MS ?? 1500,
  },
};
