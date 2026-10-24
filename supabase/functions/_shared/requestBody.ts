import { ProjectSApplicationError } from '@project-s/application';
import {
  BodyTooLargeError,
  PROJECT_S_PUBLIC_REQUEST_MAX_BYTES,
  readBoundedText,
} from '@project-s/contracts';

export const parseRequestBody = async (request: Request): Promise<unknown> => {
  let text: string;
  try {
    text = await readBoundedText(request.body, PROJECT_S_PUBLIC_REQUEST_MAX_BYTES, {
      declaredLength: request.headers.get('content-length'),
      signal: request.signal,
    });
  } catch (cause) {
    if (cause instanceof BodyTooLargeError) {
      throw new ProjectSApplicationError({
        status: 413,
        code: 'VALIDATION_ERROR',
        detail: 'The request body is too large.',
      });
    }
    throw cause;
  }
  try {
    return JSON.parse(text || '{}') as unknown;
  } catch (cause) {
    throw new ProjectSApplicationError({
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'The request body must be valid JSON.',
      cause,
    });
  }
};
