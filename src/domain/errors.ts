export type DomainErrorCode =
  | "invalid_amount"
  | "invalid_quantity"
  | "invalid_text"
  | "invalid_imei"
  | "duplicate_imei"
  | "not_found"
  | "invalid_state"
  | "insufficient_stock"
  | "invalid_period"
  | "invalid_name"
  | "invalid_pin"
  | "weak_pin";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
