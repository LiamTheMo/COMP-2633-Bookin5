/** The request broke a booking rule; nothing was sent to the library. */
export class PolicyViolationError extends Error {
  readonly code = "POLICY_VIOLATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

/** The library site timed out, returned an error, or could not be reached. */
export class LibraryUnavailableError extends Error {
  readonly code = "LIBRARY_UNAVAILABLE" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LibraryUnavailableError";
  }
}

/** The library responded, but not in the shape the adapter understands. */
export class LibraryFormatError extends Error {
  readonly code = "LIBRARY_FORMAT_CHANGED" as const;
  constructor(message: string) {
    super(message);
    this.name = "LibraryFormatError";
  }
}
