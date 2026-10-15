/*
 * MathSolver
 * A robust, dependency-free mathematical expression evaluation and equation solving engine.
 * Supports:
 * - Standard operators: +, -, *, /, ^, %
 * - Functions: sin, cos, tan, asin, acos, atan, sqrt, abs, ln, log
 * - Constants: pi, e, deg (for degree conversion, e.g., 90deg)
 * - Implicit multiplication: 2x, 3(x+1)
 * - Equation solving (Newton-Raphson): x^2 = 4 -> 2
 */
const MathSolver = (function() {
    // Configuration
    const OPS = {
        '+': { prec: 1, assoc: 'L', fn: (a, b) => a + b },
        '-': { prec: 1, assoc: 'L', fn: (a, b) => a - b },
        '*': { prec: 2, assoc: 'L', fn: (a, b) => a * b },
        '/': { prec: 2, assoc: 'L', fn: (a, b) => a / b },
        '%': { prec: 2, assoc: 'L', fn: (a, b) => a % b },
        '^': { prec: 3, assoc: 'R', fn: (a, b) => Math.pow(a, b) }
    };

    const FUNCS = {
        'sin': Math.sin, 'cos': Math.cos, 'tan': Math.tan,
        'asin': Math.asin, 'acos': Math.acos, 'atan': Math.atan,
        'sqrt': Math.sqrt, 'abs': Math.abs,
        'ln': Math.log, 'log': Math.log10
    };

    const CONSTS = {
        'pi': Math.PI,
        'e': Math.E,
        'deg': Math.PI / 180 // Allows "sin(90deg)" -> sin(90 * PI/180)
    };

    function tokenize(str) {
        const tokens = [];
        // Match: Numbers, Identifiers (vars/funcs), Operators/Parens
        const regex = /(\d+(?:\.\d+)?)|([a-zA-Z]+)|([+\-*/^%()])/g;
        let match;

        while ((match = regex.exec(str)) !== null) {
            const [full, num, id, op] = match;
            if (num) {
                tokens.push({ type: 'NUM', val: parseFloat(num) });
            } else if (id) {
                const lower = id.toLowerCase();
                if (CONSTS.hasOwnProperty(lower)) {
                    tokens.push({ type: 'NUM', val: CONSTS[lower] });
                } else if (FUNCS.hasOwnProperty(lower)) {
                    tokens.push({ type: 'FUNC', val: lower });
                } else {
                    tokens.push({ type: 'VAR', val: lower });
                }
            } else if (op) {
                tokens.push({ type: 'OP', val: op });
            }
        }
        return tokens;
    }

    function addImplicitMultiplication(tokens) {
        const result = [];
        for (let i = 0; i < tokens.length; i++) {
            const curr = tokens[i];
            result.push(curr);

            if (i < tokens.length - 1) {
                const next = tokens[i+1];
                // Insert '*' if current is (NUM, VAR, ')') and next is (VAR, FUNC, '(')
                // Examples: "2x", "x(y)", ")x"
                const isCurrEndGroup = (curr.type === 'NUM' || curr.type === 'VAR' || (curr.type === 'OP' && curr.val === ')'));
                const isNextStartGroup = (next.type === 'NUM' || next.type === 'VAR' || next.type === 'FUNC' || (next.type === 'OP' && next.val === '('));

                if (isCurrEndGroup && isNextStartGroup) {
                    result.push({ type: 'OP', val: '*' });
                }
            }
        }
        return result;
    }

    function toRPN(tokens) {
        const queue = [];
        const stack = [];

        for (const token of tokens) {
            if (token.type === 'NUM' || token.type === 'VAR') {
                queue.push(token);
            } else if (token.type === 'FUNC') {
                stack.push(token);
            } else if (token.type === 'OP') {
                if (token.val === '(') {
                    stack.push(token);
                } else if (token.val === ')') {
                    while (stack.length && stack[stack.length - 1].val !== '(') {
                        queue.push(stack.pop());
                    }
                    if (stack.length) stack.pop(); // Pop '('
                    if (stack.length && stack[stack.length - 1].type === 'FUNC') {
                        queue.push(stack.pop());
                    }
                } else {
                    while (stack.length) {
                        const top = stack[stack.length - 1];
                        if (top.type !== 'OP' || top.val === '(') break;
                        const p1 = OPS[token.val].prec;
                        const p2 = OPS[top.val].prec;
                        const assoc = OPS[token.val].assoc;
                        if ((assoc === 'L' && p1 <= p2) || (assoc === 'R' && p1 < p2)) {
                            queue.push(stack.pop());
                        } else break;
                    }
                    stack.push(token);
                }
            }
        }
        while (stack.length) queue.push(stack.pop());
        return queue;
    }

    function evaluateRPN(rpn, varValues = {}) {
        const stack = [];
        for (const token of rpn) {
            if (token.type === 'NUM') {
                stack.push(token.val);
            } else if (token.type === 'VAR') {
                if (varValues.hasOwnProperty(token.val)) {
                    stack.push(varValues[token.val]);
                } else {
                    throw new Error(`Unknown variable: ${token.val}`);
                }
            } else if (token.type === 'OP') {
                if (stack.length < 2) throw new Error('Invalid expression');
                const b = stack.pop();
                const a = stack.pop();
                stack.push(OPS[token.val].fn(a, b));
            } else if (token.type === 'FUNC') {
                if (stack.length < 1) throw new Error('Invalid expression');
                stack.push(FUNCS[token.val](stack.pop()));
            }
        }
        if (stack.length !== 1) throw new Error('Invalid result');
        return stack[0];
    }

    function evaluateExpr(exprStr, varValues = {}) {
        const tokens = tokenize(exprStr);
        if (!tokens.length) return null;
        const processed = addImplicitMultiplication(tokens);
        const rpn = toRPN(processed);
        return evaluateRPN(rpn, varValues);
    }

    function getUnknownVars(str, knownVars) {
        const tokens = tokenize(str);
        const vars = new Set();
        for (const t of tokens) {
            if (t.type === 'VAR' && !knownVars.hasOwnProperty(t.val)) {
                vars.add(t.val);
            }
        }
        return vars;
    }

    function solveEquation(lhsStr, rhsStr, knownVars = {}) {
        // Find unknown variables
        const allTokens = [...tokenize(lhsStr), ...tokenize(rhsStr)];
        const vars = new Set();
        for (const t of allTokens) {
            if (t.type === 'VAR' && !knownVars.hasOwnProperty(t.val)) {
                vars.add(t.val);
            }
        }

        if (vars.size === 0) {
            try {
                const l = evaluateExpr(lhsStr, knownVars);
                const r = evaluateExpr(rhsStr, knownVars);
                return Math.abs(l - r) < 1e-9 ? "True" : "False";
            } catch(e) { return null; }
        }
        if (vars.size > 1) return null; // Cannot solve multi-var

        const varName = vars.values().next().value;
        const f = (x) => {
            const ctx = { ...knownVars, [varName]: x };
            return evaluateExpr(lhsStr, ctx) - evaluateExpr(rhsStr, ctx);
        };

        // Newton-Raphson
        let x = 1.0;
        for (let i = 0; i < 20; i++) {
            const y = f(x);
            if (!isFinite(y)) { x = 0.5; continue; }
            if (Math.abs(y) < 1e-7) return { var: varName, val: x, str: `${varName} = ${formatResult(x)}` };

            const h = 1e-5;
            let dy = (f(x + h) - y) / h;
            if (Math.abs(dy) < 1e-9) dy = 1e-5;

            const nextX = x - y / dy;
            if (Math.abs(nextX - x) < 1e-7) return { var: varName, val: nextX, str: `${varName} = ${formatResult(nextX)}` };
            x = nextX;
        }
        return null;
    }

    function formatResult(n) {
        if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n).toString();
        return parseFloat(n.toFixed(4)).toString();
    }

    return {
        /**
         * Solves an expression or equation.
         * @param {string} input - The string to solve (e.g. "2+2", "x^2-4=0")
         * @param {object} context - Optional map of variable values {x: 5, y: 10}
         * @returns {string|null} The result as a string, or null if failed.
         */
        solve: function(input, context = {}) {
            try {
                if (!input || typeof input !== 'string') return null;
                input = input.trim();
                const parts = input.split('=');
                if (parts.length > 2) return null;

                if (parts.length === 2) {
                    if (!parts[0].trim() || !parts[1].trim()) return null;
                    const res = solveEquation(parts[0], parts[1], context);
                    return res ? res.str : null;
                } else {
                    const res = evaluateExpr(input, context);
                    if (!isFinite(res) || isNaN(res)) return null;
                    return formatResult(res);
                }
            } catch (e) {
                return null;
            }
        },
        /**
         * Resolves a list of lines to build a variable context.
         * Returns solution for the last line if possible.
         */
        solveContext: function(lines) {
            const context = {};
            let lastResult = null;

            for (const line of lines) {
                if (!line.trim()) continue;

                // Try to equate
                const parts = line.split('=');
                if (parts.length === 2) {
                    const lhs = parts[0].trim();
                    const rhs = parts[1].trim();
                    // Is rhs unresolved? e.g. "x=y+1", but try resolving rhs first
                    if (rhs && !getUnknownVars(rhs, context).size) {
                        try {
                           const rhsVal = evaluateExpr(rhs, context);
                           // If lhs is just a variable name, assign it
                           if (/^[a-zA-Z]+$/.test(lhs)) {
                               context[lhs] = rhsVal;
                               lastResult = `${lhs} = ${formatResult(rhsVal)}`;
                               continue;
                           }
                        } catch(e) {}
                    }

                    // Try solving equation
                    const eqRes = solveEquation(lhs, rhs, context);
                    if (eqRes && typeof eqRes === 'object') { // It returned {var, val, str}
                        context[eqRes.var] = eqRes.val;
                        lastResult = eqRes.str;
                    }
                } else {
                    // Expression
                    try {
                        const val = evaluateExpr(line, context);
                        if (val !== null && isFinite(val) && !isNaN(val)) {
                            lastResult = formatResult(val);
                        }
                    } catch(e) {}
                }
            }
            return { context, lastResult };
        }
    };
})();
