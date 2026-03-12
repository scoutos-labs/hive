import type { Context, MiddlewareHandler } from 'hono';
import { z, ZodError, type ZodTypeAny } from 'zod';

const validatedBodyStore = new WeakMap<Context, unknown>();
const validatedQueryStore = new WeakMap<Context, unknown>();

type ValidationDetail = {
  code: string;
  path: string;
  message: string;
};

function formatZodIssues(error: ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function toValidationErrorResponse(
  c: Context,
  source: 'body' | 'query',
  details: ValidationDetail[],
  fallbackMessage = 'Validation failed'
) {
  return c.json(
    {
      success: false,
      error: fallbackMessage,
      source,
      details,
    },
    400
  );
}

function buildQueryObject(c: Context): Record<string, string | string[]> {
  const params = new URL(c.req.url).searchParams;
  const query: Record<string, string | string[]> = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length <= 1 ? values[0] ?? '' : values;
  }

  return query;
}

export function validateBody<TSchema extends ZodTypeAny>(schema: TSchema): MiddlewareHandler {
  return async (c, next) => {
    let rawBody: unknown;

    try {
      const rawText = await c.req.text();
      rawBody = rawText.trim().length > 0 ? JSON.parse(rawText) : {};
    } catch {
      return toValidationErrorResponse(c, 'body', [
        {
          code: 'invalid_json',
          path: '',
          message: 'Request body must be valid JSON',
        },
      ]);
    }

    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      return toValidationErrorResponse(c, 'body', formatZodIssues(parsed.error));
    }

    validatedBodyStore.set(c, parsed.data);
    await next();
  };
}

export function validateQuery<TSchema extends ZodTypeAny>(schema: TSchema): MiddlewareHandler {
  return async (c, next) => {
    const parsed = schema.safeParse(buildQueryObject(c));
    if (!parsed.success) {
      return toValidationErrorResponse(c, 'query', formatZodIssues(parsed.error));
    }

    validatedQueryStore.set(c, parsed.data);
    await next();
  };
}

export function getValidatedBody<T>(c: Context): T {
  return validatedBodyStore.get(c) as T;
}

export function getValidatedQuery<T>(c: Context): T {
  return validatedQueryStore.get(c) as T;
}

export { z };
