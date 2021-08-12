type SexpKind = 'Atom' | 'Pair';

class Sexp {
  kind: SexpKind;
  atom: Token;
  pair: [Sexp, Sexp];

  constructor(kind: SexpKind, atom: Token, pair: [Sexp, Sexp]) {
    this.kind = kind;
    this.atom = atom;
    this.pair = pair;
  }

  pretty(): string {
    if (this.kind === 'Atom') {
      return this.atom.value;
    }

    if (!this.pair[1]) {
      return `(${this.pair[0].pretty()} . NIL)`;
    }

    return `(${this.pair[0].pretty()} . ${this.pair[1].pretty()})`;
  }

  static append(first: Sexp, second: Sexp) {
    if (!first) {
      return new Sexp('Pair', null, [second, null]);
    }

    if (first.kind === 'Atom') {
      return new Sexp('Pair', null, [first, second]);
    }

    return new Sexp('Pair', null, [first.pair[0], Sexp.append(first.pair[1], second)]);
  }
}

type TokenKind = 'Integer' | 'Identifier' | 'Syntax';
class Token {
  value: string;
  kind: TokenKind;

  constructor(value: string, kind: TokenKind) {
    this.value = value;
    this.kind = kind;
  }
}

function lexInteger(program: string, cursor: number): [number, Token] {
  let c = program[cursor];
  let end = cursor;
  while (c >= '0' && c <= '9') {
    end++;
    c = program[end];
  }

  return [end, new Token(program.substring(cursor, end), 'Integer')];
}

function lexIdentifier(program: string, cursor: number): [number, Token] {
  let c = program[cursor];
  let end = cursor;
  while ((c >= 'a' && c <= 'z') ||
	 (c >= 'A' && c <= 'Z') ||
	 (c === '+' || c === '-' || c === '*' || c === '&' || c === '$' || c === '%' || c === '<' || c === '=') ||
	 (end > cursor && c >= '0' && c <= '9')) {
    end++;
    c = program[end];
  }

  return [end, new Token(program.substring(cursor, end), 'Identifier')];
}

function lex(program: string): Token[] {
  const tokens: Token[] = [];
  outer:
  for (let i = 0; i < program.length; i++) {
    const c = program.charAt(i);
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
      continue;
    }

    if (c === ')' || c === '(') {
      tokens.push(new Token(c, 'Syntax'));
      continue;
    }

    const lexers = [lexInteger, lexIdentifier];
    for (let lexer of lexers) {
      const [newCursor, token] = lexer(program, i);
      if (newCursor === i) {
        continue;
      }

      i = newCursor - 1;
      tokens.push(token);
      continue outer;
    }

    throw new Error(`Unknown token near '${program.slice(i)}' at index '${i}'`);
  }

  return tokens;
}

function parse(tokens: Token[], cursor: number): [number, Sexp] {
  let siblings: Sexp = null;

  if (tokens[cursor].value !== "(") {
    throw new Error(`Expected opening parenthesis, got '${tokens[cursor].value}'`);
  }

  cursor++;

  for (let t = tokens[cursor]; cursor < tokens.length; cursor++, t = tokens[cursor]) {
    if (t.value === "(") {
      const [newCursor, child] = parse(tokens, cursor);
      siblings = Sexp.append(siblings, child);
      cursor = newCursor;
      continue;
    }

    if (t.value === ")") {
      return [cursor, siblings];
    }

    const s = new Sexp('Atom', t, null);
    siblings = Sexp.append(siblings, s);
  }

  return [cursor, siblings];
}

function evalLispArgs(args: Sexp, ctx: Map<string, any>): any[] {
  const evalLispledArgs: any[] = [];
  while (args) {
    evalLispledArgs.push(evalLisp(args.pair[0], ctx));
    args = args.pair[1];
  }
  return evalLispledArgs;
}

function evalLisp(ast: Sexp, ctx: Map<string, any>): any {
  if (ast.kind === 'Pair') {
    const fn = evalLisp(ast.pair[0], ctx);
    if (!fn) {
      throw new Error("Unknown function: " + ast.pair[0].pretty());
      return null;
    }
    const args = ast.pair[1];
    return fn(args, ctx);
  }

  if (ast.atom.kind === 'Integer') {
    return +ast.atom.value;
  }

  const value = ctx[ast.atom.value];
  if (value) {
    return value;
  }

  const builtins = {
    "<=": (args, _) => {
      const evalLispledArgs = evalLispArgs(args, ctx);
      return evalLispledArgs[0] <= evalLispledArgs[1];
    },
    "if": (args, _) => {
      const test = evalLisp(args.pair[0], ctx);
      if (test) {
	return evalLisp(args.pair[1].pair[0], ctx);
      }
      
      return evalLisp(args.pair[1].pair[1].pair[0], ctx);
    },
    "def": (args, _) => {
      const evalLispledArg = evalLisp(args.pair[1].pair[0], ctx);
      ctx[args.pair[0].atom.value] = evalLispledArg;
      return evalLispledArg;
    },
    "lambda": (args, _) => {
      const params = args.pair[0];
      const body = args.pair[1];

      return (callArgs, callCtx) => {
	const evalLispledCallArgs = evalLispArgs(callArgs, callCtx);
	const childCallCtx = { ...callCtx };
	let iter = params;
	let i = 0;
	while (iter) {
	  childCallCtx[iter.pair[0].atom.value] = evalLispledCallArgs[i];
	  i++;
	  iter = iter.pair[1];
	}

	let begin = new Sexp('Atom', new Token("begin", 'Identifier'), null);
	begin = Sexp.append(begin, body);
	return evalLisp(begin, childCallCtx);
      };
    },
    "begin": (args, _) => {
      let res = null;
      while (args) {
	res = evalLisp(args.pair[0], ctx);
	args = args.pair[1];
      }

      return res;
    },
    "+": (args, _) => {
      let res = 0;
      for (let arg of evalLispArgs(args, ctx)) {
	res += arg;
      }

      return res;
    },
    "-": (args, _) => {
      const evalLispledArgs = evalLispArgs(args, ctx);
      let res = evalLispledArgs[0];
      let rest = evalLispledArgs.slice(1);
      for (let arg of rest) {
	res -= arg;
      }
      return res;
    },
  };

  if (!builtins[ast.atom.value]) {
    throw new Error("Undefined value: " + ast.atom.value);
    return null;
  }

  return builtins[ast.atom.value];
}

function main() {
  const program = process.argv[2];
  const tokens = lex(program);
  let begin = new Sexp('Atom', new Token("begin", 'Identifier'), null);
  begin = Sexp.append(begin, null);
  let [cursor, child] = parse(tokens, 0);
  begin = Sexp.append(begin, child);
  while (cursor !== tokens.length - 1) {
    ([cursor, child] = parse(tokens, cursor+1));
    begin = Sexp.append(begin, child);
  }
  const result = evalLisp(begin, {} as Map<string, any>);
  console.log(result);
}

main();
