export function formatNaira(amount: number): string {
  if (amount === 0) return '₦0';
  return `₦${Number(amount).toLocaleString('en-NG')}`;
}
