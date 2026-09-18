export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

const WEIGHTS1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const WEIGHTS2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function checkDigit(digits: readonly number[], weights: readonly number[]): number {
  const sum = digits.reduce((acc, digit, index) => acc + digit * (weights[index] ?? 0), 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

/** CNPJ com dígitos verificadores. Aceita mascarado ou só números. */
export function isValidCnpj(value: string): boolean {
  const raw = digitsOnly(value);
  if (raw.length !== 14) {
    return false;
  }
  if (/^(\d)\1{13}$/.test(raw)) {
    return false;
  }
  const nums = raw.split('').map((part) => Number(part));
  const first = checkDigit(nums.slice(0, 12), WEIGHTS1);
  if (first !== nums[12]) {
    return false;
  }
  const second = checkDigit(nums.slice(0, 13), WEIGHTS2);
  return second === nums[13];
}
