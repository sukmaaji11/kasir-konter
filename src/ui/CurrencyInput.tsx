import { useId } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";

interface CurrencyInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "inputMode" | "onChange" | "type" | "value"
  > {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}

export function CurrencyInput({
  value,
  onValueChange,
  ...props
}: CurrencyInputProps) {
  const inputId = useId();
  const formattedValue = formatRupiahInput(value);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const digitsBeforeCaret = input.value
      .slice(0, input.selectionStart ?? input.value.length)
      .replace(/\D/g, "").length;
    const nextValue = input.value.replace(/\D/g, "");
    onValueChange(nextValue);

    const nextFormattedValue = formatRupiahInput(nextValue);
    requestAnimationFrame(() => {
      input.setSelectionRange(
        caretAfterDigitCount(nextFormattedValue, digitsBeforeCaret),
        caretAfterDigitCount(nextFormattedValue, digitsBeforeCaret),
      );
    });
  }

  return (
    <input
      {...props}
      id={props.id ?? inputId}
      type="text"
      inputMode="numeric"
      value={formattedValue}
      onChange={handleChange}
    />
  );
}

export function formatRupiahInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function caretAfterDigitCount(value: string, digitCount: number): number {
  if (digitCount === 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index]!)) {
      seen += 1;
      if (seen === digitCount) return index + 1;
    }
  }
  return value.length;
}
