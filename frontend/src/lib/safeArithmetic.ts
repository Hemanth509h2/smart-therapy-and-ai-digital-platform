/**
 * Evaluates a plain arithmetic expression: numbers, + - * /, unary minus and
 * parentheses. Nothing else is accepted, so text from shared session state can
 * never run as code (it used to go through eval()).
 *
 * Returns the result, or null when the input is not a valid expression or the
 * result is not a finite number (e.g. division by zero).
 */
export function evaluateArithmetic(input: string): number | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 200) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(input)) return null;

  const tokens = input.match(/\d+(?:\.\d+)?|\.\d+|[+\-*/()]/g);
  if (!tokens || tokens.join('') !== input.replace(/\s+/g, '')) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // expr := term (('+' | '-') term)*
  function expr(): number {
    let value = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = term();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  // term := factor (('*' | '/') factor)*
  function term(): number {
    let value = factor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = factor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  // factor := ('+' | '-') factor | number | '(' expr ')'
  function factor(): number {
    const tok = next();
    if (tok === '-') return -factor();
    if (tok === '+') return factor();
    if (tok === '(') {
      const value = expr();
      if (next() !== ')') throw new Error('unbalanced');
      return value;
    }
    if (tok !== undefined && /^(\d+(\.\d+)?|\.\d+)$/.test(tok)) return Number(tok);
    throw new Error('unexpected token');
  }

  try {
    const result = expr();
    if (pos !== tokens.length) return null;
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}
