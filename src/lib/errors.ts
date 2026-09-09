export class AppError extends Error {
  status: number;
  code: string;
  suggestion?: string;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    suggestion?: string,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.suggestion = suggestion;
    this.details = details;
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: error.code,
        message: error.message,
        suggestion: error.suggestion,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.status }
    );
  }

  console.error(error);
  return Response.json(
    {
      error: "internal_error",
      message: "Something went wrong.",
    },
    { status: 500 }
  );
}
