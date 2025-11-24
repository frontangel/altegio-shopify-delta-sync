import { z } from 'zod';

const requiredInt = (name) =>
  z
    .string({ required_error: `${name} is required` })
    .trim()
    .regex(/^\d+$/, `${name} must be a positive integer`)
    .transform((val) => Number(val));

const optionalInt = () =>
  z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform((val) => Number(val))
    .optional();

const envSchema = z.object({
  PORT: optionalInt(),
  WARMUP_ON_START: z.string().optional(),

  ALTEGIO_COMPANY_ID: requiredInt('ALTEGIO_COMPANY_ID'),
  ALTEGIO_STORAGE_ID: requiredInt('ALTEGIO_STORAGE_ID'),
  ALTEGIO_TOKEN: z.string().min(1),
  ALTEGIO_USER_TOKEN: z.string().min(1),

  SF_API_VERSION: z.string().min(1),
  SF_DOMAIN: z.string().min(1),
  SF_ADMIN_ACCESS_TOKEN: z.string().min(1),
  SF_CONST_LOCATION_ID: z.string().min(1),

  BASIC_AUTH_USER: z.string().optional(),
  BASIC_AUTH_PASS: z.string().optional(),

  IDEMPOTENCY_TTL_MS: optionalInt(),
  QUEUE_BACKOFF_BASE_MS: optionalInt(),
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
