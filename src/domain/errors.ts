export type DomainErrorCode =
  | "invalid_amount"
  | "invalid_quantity"
  | "invalid_text"
  | "invalid_imei"
  | "duplicate_imei"
  | "not_found"
  | "invalid_state"
  | "insufficient_stock"
  | "invalid_period";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
