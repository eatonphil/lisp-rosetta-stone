type SexpKind = 'Atom' | 'Pair';

interface SexpAtom {
  kind: 'Atom';
  atom: Token;
}

interface SexpPair {
  kind: 'Pair';
  pair: [Sexp, Sexp | null];
}

type Sexp = SexpAtom | SexpPair;

function makeSexpPair(pair: [Sexp, Sexp | null]): SexpPair {
  return { kind: 'Pair', pair };
}

function makeSexpAtom(atom: Token): SexpAtom {
  return { kind: 'Atom', atom };
}

function pretty(sexp: Sexp): string {
  if (sexp.kind === 'Atom') {
    return sexp.atom.value;
  }

  if (!sexp.pair[1]) {
    return `(${pretty(sexp.pair[0])} . NIL)`;
  }

  return `(${pretty(sexp.pair[0])} . ${pretty(sexp.pair[1])})`;
}

function append(first: Sexp | null, second: Sexp | null): Sexp {
  if (!first) {
    if(!second) {
      throw new Error("Expected second.")
    }
    return makeSexpPair([second, null]);
  }

  if (first.kind === 'Atom') {
    return makeSexpPair([first, second]);
  }

  return makeSexpPair([first.pair[0], append(first.pair[1], second)]);
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

function parse(tokens: Token[], cursor: number): [number, Sexp | null] {
  let siblings: Sexp | null = null;

  if (tokens[cursor].value !== "(") {
    throw new Error(`Expected opening parenthesis, got '${tokens[cursor].value}'`);
  }

  cursor++;

  for (let t = tokens[cursor]; cursor < tokens.length; cursor++, t = tokens[cursor]) {
    if (t.value === "(") {
      const [newCursor, child] = parse(tokens, cursor);
      if(!child) {
        throw new Error("Expected child.");
      }
      siblings = append(siblings, child);
      cursor = newCursor;
      continue;
    }

    if (t.value === ")") {
      return [cursor, siblings];
    }

    const s = makeSexpAtom(t);
    siblings = append(siblings, s);
  }

  return [cursor, siblings];
}

type Context = Map<string, any>;

function evalLispArgs(args: Sexp, ctx: Context): any[] {
  const evalLispledArgs: any[] = [];
  let currentArgNode: Sexp | null = args;
  while (currentArgNode) {
    if(currentArgNode.kind !== "Pair") {
      throw new Error("Expected linked list.");
    }
    evalLispledArgs.push(evalLisp(currentArgNode.pair[0], ctx));
    currentArgNode = currentArgNode.pair[1];
  }
  return evalLispledArgs;
}

function evalLisp(ast: Sexp, ctx: Context): any {
  if (ast.kind === 'Pair') {
    const fn = evalLisp(ast.pair[0], ctx);
    if (!fn) {
      throw new Error("Unknown function: " + pretty(ast.pair[0]));
      return null;
    }
    const args = ast.pair[1];
    return fn(args, ctx);
  }

  if (ast.atom.kind === 'Integer') {
    return +ast.atom.value;
  }

  const value = ctx.get(ast.atom.value);
  if (value) {
    return value;
  }

  const builtins = {
    "<=": (args: any) => {
      const evalLispledArgs = evalLispArgs(args, ctx);
      return evalLispledArgs[0] <= evalLispledArgs[1];
    },
    "if": (args: any) => {
      const test = evalLisp(args.pair[0], ctx);
      if (test) {
	return evalLisp(args.pair[1].pair[0], ctx);
      }
      
      return evalLisp(args.pair[1].pair[1].pair[0], ctx);
    },
    "def": (args: any) => {
      const evalLispledArg = evalLisp(args.pair[1].pair[0], ctx);
      ctx.set(args.pair[0].atom.value, evalLispledArg);
      return evalLispledArg;
    },
    "lambda": (args: any) => {
      const params = args.pair[0];
      const body = args.pair[1];

      return (callArgs: Sexp, callCtx: Context) => {
	const evalLispledCallArgs = evalLispArgs(callArgs, callCtx);
	const childCallCtx = new Map(callCtx);
	let iter = params;
	let i = 0;
	while (iter) {
	  childCallCtx.set(iter.pair[0].atom.value, evalLispledCallArgs[i]);
	  i++;
	  iter = iter.pair[1];
	}

	let begin: Sexp = makeSexpAtom(new Token("begin", 'Identifier'));
	begin = append(begin, body);
	return evalLisp(begin, childCallCtx);
      };
    },
    "begin": (args: any) => {
      let res = null;
      let current = args;
      while (current) {
	res = evalLisp(current.pair[0], ctx);
	current = current.pair[1];
      }

      return res;
    },
    "+": (args: any) => {
      let res = 0;
      for (let arg of evalLispArgs(args, ctx)) {
	res += arg;
      }

      return res;
    },
    "-": (args: any) => {
      const evalLispledArgs = evalLispArgs(args, ctx);
      let res = evalLispledArgs[0];
      let rest = evalLispledArgs.slice(1);
      for (let arg of rest) {
	res -= arg;
      }
      return res;
    },
  };

  const key = ast.atom.value as keyof typeof builtins;

  if (!builtins[key]) {
    throw new Error("Undefined value: " + ast.atom.value);
    return null;
  }

  return builtins[key];
}

function main() {
  const program = process.argv[2];
  const tokens = lex(program);
  let begin: Sexp = makeSexpAtom(new Token("begin", 'Identifier'));
  begin = append(begin, null);
  let [cursor, child] = parse(tokens, 0);
  begin = append(begin, child);
  while (cursor !== tokens.length - 1) {
    ([cursor, child] = parse(tokens, cursor+1));
    begin = append(begin, child);
  }
  const result = evalLisp(begin, new Map);
  console.log(result);
}

main();
