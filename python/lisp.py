import sys
from enum import auto, Enum, unique
from typing import Any, NamedTuple, Optional, Tuple


@unique
class TokenKind(Enum):
    INTEGER = auto()
    IDENTIFIER = auto()
    SYNTAX = auto()


class Token(NamedTuple):
    value: str
    kind: TokenKind


@unique
class SexpKind(Enum):
    ATOM = auto()
    PAIR = auto()


class Sexp(NamedTuple):
    kind: SexpKind
    atom: Optional[Token]
    pair: Tuple

    def __str__(self) -> str:
        if self.kind == SexpKind.ATOM:
            assert self.atom is not None
            return self.atom.value

        if self.pair[1] is None:
            return f'({self.pair[0]!s} . NIL)'

        return f'({self.pair[0]!s} . {self.pair[1]!s})'

    @staticmethod
    def create_pair(head, tail):
        return Sexp(SexpKind.PAIR, None, (head, tail))

    @staticmethod
    def create_atom(token):
        return Sexp(SexpKind.ATOM, token, (None, None))

def sexp_append(first: Optional[Sexp], second: Optional[Sexp]) -> Sexp:
    if first is None:
        assert second is not None
        return Sexp.create_pair(second, None)

    if first.kind == SexpKind.ATOM:
        return Sexp.create_pair(first, second)

    appended = sexp_append(first.pair[1], second)
    return Sexp.create_pair(first.pair[0], appended)


def lex_integer(program: str, cursor: int) -> Tuple[int, Token]:
    c = program[cursor]
    end = cursor
    while '0' <= c <= '9':
        end += 1
        c = program[end]

    return end, Token(program[cursor:end], TokenKind.INTEGER)


def lex_identifier(program: str, cursor: int) -> Tuple[int, Token]:
    c = program[cursor]
    end = cursor
    while ('a' <= c <= 'z') or \
          ('A' <= c <= 'Z') or \
          c in '+-*&$%<=' or \
          (end > cursor and '0' <= c <= '9'):
        end += 1
        c = program[end]

    return end, Token(program[cursor:end], TokenKind.IDENTIFIER)


def lex(program: str) -> list[Token]:
    tokens = []
    i = 0
    while i < len(program):
        c = program[i]
        if c in ' \n\t\r':
            i += 1
            continue

        if c in '()':
            tokens.append(Token(c, TokenKind.SYNTAX))
            i += 1
            continue

        for lexer in [lex_integer, lex_identifier]:
            new_cursor, token = lexer(program, i)
            if new_cursor == i:
                continue

            i = new_cursor
            tokens.append(token)
            break
        else:
            raise SyntaxError(f"Unknown token near '{program[i:]}' at index '{i}'")

    return tokens


def parse(tokens: list[Token], cursor: int) -> Tuple[int, Optional[Sexp]]:
    siblings = None

    if tokens[cursor].value != "(":
        raise ValueError("Expected opening parenthesis, got: " + tokens[cursor].value)

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

        s = Sexp.create_atom(t)
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
        child_call_ctx = call_ctx.copy()

        i = 0
        it = params
        while it:
            child_call_ctx[it.pair[0].atom.value] = evalled_call_args[i]
            i += 1
            it = it.pair[1]

        begin = Sexp.create_atom(Token("begin", TokenKind.IDENTIFIER))
        begin = sexp_append(begin, body)
        return eval_lisp(begin, child_call_ctx)

    return _lambda_internal


def builtin_begin(args: Sexp, ctx: dict[str, Any]) -> Any:
    res = None
    while args:
        res = eval_lisp(args.pair[0], ctx)
        args = args.pair[1]

    return res


def builtin_plus(args: Sexp, ctx: dict[str, Any]) -> Any:
    return sum(eval_lisp_args(args, ctx))


def builtin_minus(args: Sexp, ctx: dict[str, Any]) -> Any:
    evalled_args = eval_lisp_args(args, ctx)
    evalled_args[0] *= -1
    return -sum(evalled_args)


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
            raise LookupError(f"Unknown def: {ast.pair[0]!s}")

        return fn(ast.pair[1], ctx)

    assert ast.atom is not None
    if ast.atom.kind == TokenKind.INTEGER:
        return int(ast.atom.value)

    if ast.atom.value in ctx:
        return ctx[ast.atom.value]

    if ast.atom.value not in BUILTINS:
        raise LookupError("Undefined value: " + ast.atom.value)

    return BUILTINS[ast.atom.value]


def main():
    program = sys.argv[1]
    tokens = lex(program)

    begin = Sexp.create_atom(Token("begin", TokenKind.IDENTIFIER))
    begin = sexp_append(begin, None)

    cursor = -1
    while cursor < len(tokens) - 1:
        cursor, child = parse(tokens, cursor + 1)
        begin = sexp_append(begin, child)

    result = eval_lisp(begin, {})
    print(result)


main()
