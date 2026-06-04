export class AppError extends Error {
  status: number;
  code: string;
  suggestion?: string;

  constructor(status: number, code: string, message: string, suggestion?: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.suggestion = suggestion;
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: error.code,
        message: error.message,
        suggestion: error.suggestion,
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
