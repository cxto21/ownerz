// DataVaultz SDK — shared Cairo/Starknet encoding helpers.
const U128_MASK = (1n << 128n) - 1n

// Encode a bigint/number/hex string into a Cairo u256 { low, high } pair.
export function toU256(value) {
  const v = typeof value === 'bigint' ? value : BigInt(value)
  if (v < 0n) throw new Error('toU256: value must be non-negative')
  return { low: v & U128_MASK, high: v >> 128n }
}

// Decode a Cairo u256 { low, high } pair back into a bigint.
export function fromU256({ low, high }) {
  return (BigInt(high) << 128n) | (BigInt(low) & U128_MASK)
}

// True for the zero address / unset address.
export function isZeroAddress(address) {
  if (!address) return true
  const a = String(address).toLowerCase()
  return a === '0x0' || a === '0x' || /^0x0+$/.test(a)
}
