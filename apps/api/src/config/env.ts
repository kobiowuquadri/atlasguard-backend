import { z } from 'zod';

/** Empty strings (e.g. `COOKIE_SECURE=` in .env) mean "not set", never "false". */
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const bool = {
  optional: () => z.preprocess(blankToUndefined, z.stringbool().optional()),
  default: (value: boolean) => z.preprocess(blankToUndefined, z.stringbool().default(value)),
};
const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    APP_ORIGINS: csv.pipe(z.array(z.url())).default(['http://localhost:3000']),
    TRUST_PROXY: bool.default(false),

    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('ag_session'),
    SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 90).default(168),
    COOKIE_SECURE: bool.optional(),
    API_KEY_PEPPER: z.string().optional(),
    ADMIN_EMAILS: csv.transform((emails) => emails.map((e) => e.toLowerCase())),

    NATLAS_BASE_URL: z.union([z.url(), z.literal('')]).default(''),
    NATLAS_API_KEY: z.string().default(''),
    NATLAS_MODEL_ID: z.string().min(1).default('NCAIR1/N-ATLaS'),
    NATLAS_MODEL_REVISION: z.string().default(''),
    NATLAS_ACCEPTED_MODEL_NAMES: csv,
    NATLAS_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    NATLAS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    NATLAS_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    NATLAS_HEALTH_PATH: z.string().startsWith('/').default('/health'),

    ENABLE_FIXTURE_PROVIDER: bool.optional(),
    FIXTURE_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(400),

    WORKER_ENABLED: bool.default(true),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    WORKER_STALE_AFTER_MS: z.coerce.number().int().min(5_000).default(120_000),
    CASE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    MAX_CASES_PER_RUN: z.coerce.number().int().min(1).max(5000).default(500),

    AUTO_SEED_BENCHMARKS: bool.default(true),
    RATE_LIMIT_ENABLED: bool.default(true),
    SWAGGER_ENABLED: bool.default(true),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.API_KEY_PEPPER || env.API_KEY_PEPPER.length < 32) {
        ctx.addIssue({ code: 'custom', path: ['API_KEY_PEPPER'], message: 'must be at least 32 characters in production' });
      }
      if (env.ENABLE_FIXTURE_PROVIDER === true) {
        ctx.addIssue({
          code: 'custom',
          path: ['ENABLE_FIXTURE_PROVIDER'],
          message: 'simulated fixtures cannot be enabled in production',
        });
      }
    }
  });

export type AppConfig = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE' | 'ENABLE_FIXTURE_PROVIDER' | 'API_KEY_PEPPER'> & {
  COOKIE_SECURE: boolean;
  ENABLE_FIXTURE_PROVIDER: boolean;
  API_KEY_PEPPER: string;
  isProduction: boolean;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Parses and validates process environment; throws a readable error listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid AtlasGuard API configuration:\n${problems}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  return {
    ...env,
    isProduction,
    COOKIE_SECURE: env.COOKIE_SECURE ?? isProduction,
    ENABLE_FIXTURE_PROVIDER: env.ENABLE_FIXTURE_PROVIDER ?? !isProduction,
    API_KEY_PEPPER: env.API_KEY_PEPPER || 'atlasguard-development-pepper-not-secret',
  };
}
