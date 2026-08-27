import type { ProjectSProblemCode } from '@project-s/contracts';

export interface ApplicationErrorOptions {
  status: number;
  code: ProjectSProblemCode;
  detail: string;
  retryAction?:
    | 'choose_alternative'
    | 'confirm_in_browser'
    | 'prepare_again'
    | 'retry'
    | 'retry_after'
    | 'contact_support';
  afterSeconds?: number;
  fieldErrors?: ReadonlyArray<{
    path: string;
    message: string;
    code?: string;
  }>;
  alternatives?: ReadonlyArray<{ startAt: string; endAt: string }>;
  cause?: unknown;
}

export class ProjectSApplicationError extends Error {
  readonly status: number;
  readonly code: ProjectSProblemCode;
  readonly retryAction?: ApplicationErrorOptions['retryAction'];
  readonly afterSeconds?: number;
  readonly fieldErrors?: ApplicationErrorOptions['fieldErrors'];
  readonly alternatives?: ApplicationErrorOptions['alternatives'];
  override readonly cause?: unknown;

  constructor(options: ApplicationErrorOptions) {
    super(options.detail);
    this.name = 'ProjectSApplicationError';
    this.status = options.status;
    this.code = options.code;
    this.retryAction = options.retryAction;
    this.afterSeconds = options.afterSeconds;
    this.fieldErrors = options.fieldErrors;
    this.alternatives = options.alternatives?.slice(0, 3);
    this.cause = options.cause;
  }
}

export const isProjectSApplicationError = (
  value: unknown,
): value is ProjectSApplicationError => value instanceof ProjectSApplicationError;
