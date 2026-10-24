import { projectSValidationError } from '@project-s/contracts';
import { z } from 'zod';

// Form limits predate Zod 4 and count UTF-16 units after optional trimming.
// Keep that acceptance boundary and the existing visible messages explicit.
export const formString = (options: {
  trim?: boolean;
  minLength?: number;
  maxLength?: number;
  minMessage?: string;
  maxMessage?: string;
} = {}): z.ZodString => {
  let schema = z.string({ error: projectSValidationError });
  if (options.trim) schema = schema.trim();
  if (options.minLength !== undefined) {
    const minimum = options.minLength;
    schema = schema.check((context) => {
      if (context.value.length < minimum) {
        context.issues.push({
          code: 'too_small', origin: 'string', minimum, inclusive: true, continue: true, input: context.value,
          message: options.minMessage ?? `String must contain at least ${minimum} character(s)`,
        });
      }
    });
  }
  if (options.maxLength !== undefined) {
    const maximum = options.maxLength;
    schema = schema.check((context) => {
      if (context.value.length > maximum) {
        context.issues.push({
          code: 'too_big', origin: 'string', maximum, inclusive: true, continue: true, input: context.value,
          message: options.maxMessage ?? `String must contain at most ${maximum} character(s)`,
        });
      }
    });
  }
  return schema;
};

// Preserve the form's former email grammar rather than adopting v4 defaults.
export const formEmailPattern = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;
