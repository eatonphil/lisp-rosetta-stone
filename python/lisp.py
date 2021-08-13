import sys
from enum import Enum
from typing import Any, Tuple


class TokenKind(Enum):
    INTEGER = 1
    IDENTIFIER = 2
    SYNTAX = 3

    
class Token():
    value: str
    kind: TokenKind

    def __init__(self, value, kind):
        self.value = value
        self.kind = kind


class SexpKind(Enum):
    ATOM = 1
    PAIR = 2


class Sexp():
    kind: SexpKind
    atom: Token
    pair: Tuple['Sexp', 'Sexp']

    def __init__(self, kind, atom, pair):
        self.kind = kind
        self.atom = atom
        self.pair = pair

    def pretty(self) -> str:
        if self.kind == SexpKind.ATOM:
            return self.atom.value

        if self.pair[1] is None:
            return f'({self.pair[0].pretty()} . NIL)'

        return f'({self.pair[0].pretty()} . {self.pair[1].pretty()})'


def sexp_append(first: Sexp, second: Sexp) -> Sexp:
    if first is None:
        return Sexp(SexpKind.PAIR, None, [second, None])

    if first.kind == SexpKind.ATOM:
        return Sexp(SexpKind.PAIR, None, [first, second])

    appended = sexp_append(first.pair[1], second)
    return Sexp(SexpKind.PAIR, None, [first.pair[0], appended])


def lex_integer(program: str, cursor: int) -> Tuple[int, Token]:
    c = program[cursor]
    end = cursor
    while c >= '0' and c <= '9':
        end += 1
        c = program[end]

    return end, Token(program[cursor:end], TokenKind.INTEGER)

    
def lex_identifier(program: str, cursor: int) -> Tuple[int, Token]:
    c = program[cursor]
    end = cursor
    while (c >= 'a' and c <= 'z') or \
          (c >= 'A' and c <= 'Z') or \
          c in ['+', '-', '*', '&', '$', '%', '<', '='] or \
          (end > cursor and c >= '0' and c <= '9'):
        end += 1
        c = program[end]

    return end, Token(program[cursor:end], TokenKind.IDENTIFIER)


def lex(program: str) -> list[Token]:
    tokens = []
    i = 0
    while i < len(program):
        c = program[i]
        if c == ' ' or c == '\n' or c == '\t' or c == '\r':
            i += 1
            continue

        if c == ')' or c == '(':
            tokens.append(Token(c, TokenKind.SYNTAX))
            i += 1
            continue

        lexers = [lex_integer, lex_identifier]
        found = False
        for lexer in lexers:
            new_cursor, token = lexer(program, i)
            if new_cursor == i:
                continue

            i = new_cursor
            tokens.append(token)
            found = True
            break

        if not found:
            raise Exception(fmt.Sprintf("Unknown token near '%s' at index '%d'", program[i:], i))

    return tokens


def parse(tokens: list[Token], cursor: int) -> Tuple[int, Sexp]:
    siblings = None

    if tokens[cursor].value != "(":
        raise Exception("Expected opening parenthesis, got: " + tokens[cursor].value)

    cursor += 1

    while cursor < len(tokens):
        t = tokens[cursor]
        if t.value == "(":
            new_cursor, child = parse(tokens, cursor)
            siblings = sexp_append(siblings, child)
            cursor = new_cursor + 1
            continue

        if t.value == ")":
            return cursor, siblings

        s = Sexp(SexpKind.ATOM, t, None)
        siblings = sexp_append(siblings, s)
        cursor += 1

    return cursor, siblings


def eval_lisp_args(args: Sexp, ctx: dict[str, Any]) -> list[Any]:
    evalled_args = []
    while args:
        evalled_args.append(eval_lisp(args.pair[0], ctx))
        args = args.pair[1]

    return evalled_args


def builtin_lt(args: Sexp, ctx: dict[str, Any]) -> Any:
    evalled_args = eval_lisp_args(args, ctx)
    return evalled_args[0] <= evalled_args[1]


def builtin_if(args: Sexp, ctx: dict[str, Any]) -> Any:
    test = eval_lisp(args.pair[0], ctx)
    if test:
        return eval_lisp(args.pair[1].pair[0], ctx)

    return eval_lisp(args.pair[1].pair[1].pair[0], ctx)


def builtin_def(args: Sexp, ctx: dict[str, Any]) -> Any:
    evalled_arg = eval_lisp(args.pair[1].pair[0], ctx)
    ctx[args.pair[0].atom.value] = evalled_arg
    return evalled_arg


def builtin_lambda(args: Sexp, _) -> Any:
    params = args.pair[0]
    body = args.pair[1]

    def _lambda_internal(call_args: Sexp, call_ctx: dict[str, Any]) -> Any:
        evalled_call_args = eval_lisp_args(call_args, call_ctx)
        child_call_ctx = {}
        for key, val in call_ctx.items():
            child_call_ctx[key] = val

        i = 0
        it = params
        while it:
            child_call_ctx[it.pair[0].atom.value] = evalled_call_args[i]
            i += 1
            it = it.pair[1]

        begin = Sexp(SexpKind.ATOM, Token("begin", TokenKind.IDENTIFIER), None)
        begin = sexp_append(begin, body)
        return eval_lisp(begin, child_call_ctx)

    return _lambda_internal


def builtin_begin(args: Sexp, ctx: dict[str, Any]) -> Any:
    res = None
    while args:
        res = eval_lisp(args.pair[0], ctx)
        args = args.pair[1]

    return res


def builtin_plus(args: Sexp, ctx: dict[str, any]) -> Any:
    res = 0
    args = eval_lisp_args(args, ctx)
    for arg in args:
        res += arg

    return res


def builtin_minus(args: Sexp, ctx: dict[str, Any]) -> Any:
    evalled_args = eval_lisp_args(args, ctx)
    res = evalled_args[0]
    rest = evalled_args[1:]
    for arg in rest:
        res -= arg
    return res


BUILTINS = {
    "<=": builtin_lt,
    "if": builtin_if,
    "def": builtin_def,
    "lambda": builtin_lambda,
    "begin": builtin_begin,
    "+": builtin_plus,
    "-": builtin_minus,
}


def eval_lisp(ast: Sexp, ctx: dict[str, Any]) -> Any:
    if ast.kind == SexpKind.PAIR:
        fn = eval_lisp(ast.pair[0], ctx)
        if not fn:
            raise Exception("Unknown def: " + ast.pair[0].pretty())

        return fn(ast.pair[1], ctx)

    if ast.atom.kind == TokenKind.INTEGER:
        return int(ast.atom.value)

    if ast.atom.value in ctx:
        return ctx[ast.atom.value]

    if ast.atom.value not in BUILTINS:
        raise Exception("Undefined value :" + ast.atom.value)

    return BUILTINS[ast.atom.value]


def main():
    program = sys.argv[1]
    tokens = lex(program)

    begin = Sexp(SexpKind.ATOM, Token("begin", TokenKind.IDENTIFIER), None)
    begin = sexp_append(begin, None)

    cursor = -1
    while cursor != len(tokens)-1:
        cursor, child = parse(tokens, cursor+1)
        begin = sexp_append(begin, child)

    result = eval_lisp(begin, {})
    print(result)


main()
