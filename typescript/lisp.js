"use strict";
function makeSexpPair(pair) {
    return { kind: 'Pair', pair: pair };
}
function makeSexpAtom(atom) {
    return { kind: 'Atom', atom: atom };
}
function pretty(sexp) {
    if (sexp.kind === 'Atom') {
        return sexp.atom.value;
    }
    if (!sexp.pair[1]) {
        return "(" + pretty(sexp.pair[0]) + " . NIL)";
    }
    return "(" + pretty(sexp.pair[0]) + " . " + pretty(sexp.pair[1]) + ")";
}
function append(first, second) {
    if (!first) {
        if (!second) {
            throw new Error("Expected second.");
        }
        return makeSexpPair([second, null]);
    }
    if (first.kind === 'Atom') {
        return makeSexpPair([first, second]);
    }
    return makeSexpPair([first.pair[0], append(first.pair[1], second)]);
}
var Token = /** @class */ (function () {
    function Token(value, kind) {
        this.value = value;
        this.kind = kind;
    }
    return Token;
}());
function lexInteger(program, cursor) {
    var c = program[cursor];
    var end = cursor;
    while (c >= '0' && c <= '9') {
        end++;
        c = program[end];
    }
    return [end, new Token(program.substring(cursor, end), 'Integer')];
}
function lexIdentifier(program, cursor) {
    var c = program[cursor];
    var end = cursor;
    while ((c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c === '+' || c === '-' || c === '*' || c === '&' || c === '$' || c === '%' || c === '<' || c === '=') ||
        (end > cursor && c >= '0' && c <= '9')) {
        end++;
        c = program[end];
    }
    return [end, new Token(program.substring(cursor, end), 'Identifier')];
}
function lex(program) {
    var tokens = [];
    outer: for (var i = 0; i < program.length; i++) {
        var c = program.charAt(i);
        if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
            continue;
        }
        if (c === ')' || c === '(') {
            tokens.push(new Token(c, 'Syntax'));
            continue;
        }
        var lexers = [lexInteger, lexIdentifier];
        for (var _i = 0, lexers_1 = lexers; _i < lexers_1.length; _i++) {
            var lexer = lexers_1[_i];
            var _a = lexer(program, i), newCursor = _a[0], token = _a[1];
            if (newCursor === i) {
                continue;
            }
            i = newCursor - 1;
            tokens.push(token);
            continue outer;
        }
        throw new Error("Unknown token near '" + program.slice(i) + "' at index '" + i + "'");
    }
    return tokens;
}
function parse(tokens, cursor) {
    var siblings = null;
    if (tokens[cursor].value !== "(") {
        throw new Error("Expected opening parenthesis, got '" + tokens[cursor].value + "'");
    }
    cursor++;
    for (var t = tokens[cursor]; cursor < tokens.length; cursor++, t = tokens[cursor]) {
        if (t.value === "(") {
            var _a = parse(tokens, cursor), newCursor = _a[0], child = _a[1];
            if (!child) {
                throw new Error("Expected child.");
            }
            siblings = append(siblings, child);
            cursor = newCursor;
            continue;
        }
        if (t.value === ")") {
            return [cursor, siblings];
        }
        var s = makeSexpAtom(t);
        siblings = append(siblings, s);
    }
    return [cursor, siblings];
}
function evalLispArgs(args, ctx) {
    var evalLispledArgs = [];
    var currentArgNode = args;
    while (currentArgNode) {
        if (currentArgNode.kind !== "Pair") {
            throw new Error("Expected linked list.");
        }
        evalLispledArgs.push(evalLisp(currentArgNode.pair[0], ctx));
        currentArgNode = currentArgNode.pair[1];
    }
    return evalLispledArgs;
}
function evalLisp(ast, ctx) {
    if (ast.kind === 'Pair') {
        var fn = evalLisp(ast.pair[0], ctx);
        if (!fn) {
            throw new Error("Unknown function: " + pretty(ast.pair[0]));
            return null;
        }
        var args = ast.pair[1];
        return fn(args, ctx);
    }
    if (ast.atom.kind === 'Integer') {
        return +ast.atom.value;
    }
    var value = ctx.get(ast.atom.value);
    if (value) {
        return value;
    }
    var builtins = {
        "<=": function (args, _) {
            var evalLispledArgs = evalLispArgs(args, ctx);
            return evalLispledArgs[0] <= evalLispledArgs[1];
        },
        "if": function (args, _) {
            var test = evalLisp(args.pair[0], ctx);
            if (test) {
                return evalLisp(args.pair[1].pair[0], ctx);
            }
            return evalLisp(args.pair[1].pair[1].pair[0], ctx);
        },
        "def": function (args, _) {
            var evalLispledArg = evalLisp(args.pair[1].pair[0], ctx);
            ctx.set(args.pair[0].atom.value, evalLispledArg);
            return evalLispledArg;
        },
        "lambda": function (args, _) {
            var params = args.pair[0];
            var body = args.pair[1];
            return function (callArgs, callCtx) {
                var evalLispledCallArgs = evalLispArgs(callArgs, callCtx);
                var childCallCtx = new Map(callCtx);
                var iter = params;
                var i = 0;
                while (iter) {
                    childCallCtx.set(iter.pair[0].atom.value, evalLispledCallArgs[i]);
                    i++;
                    iter = iter.pair[1];
                }
                var begin = makeSexpAtom(new Token("begin", 'Identifier'));
                begin = append(begin, body);
                return evalLisp(begin, childCallCtx);
            };
        },
        "begin": function (args, _) {
            var res = null;
            while (args) {
                res = evalLisp(args.pair[0], ctx);
                args = args.pair[1];
            }
            return res;
        },
        "+": function (args, _) {
            var res = 0;
            for (var _i = 0, _a = evalLispArgs(args, ctx); _i < _a.length; _i++) {
                var arg = _a[_i];
                res += arg;
            }
            return res;
        },
        "-": function (args, _) {
            var evalLispledArgs = evalLispArgs(args, ctx);
            var res = evalLispledArgs[0];
            var rest = evalLispledArgs.slice(1);
            for (var _i = 0, rest_1 = rest; _i < rest_1.length; _i++) {
                var arg = rest_1[_i];
                res -= arg;
            }
            return res;
        },
    };
    var key = ast.atom.value;
    if (!builtins[key]) {
        throw new Error("Undefined value: " + ast.atom.value);
        return null;
    }
    return builtins[key];
}
function main() {
    var _a;
    var program = process.argv[2];
    var tokens = lex(program);
    var begin = makeSexpAtom(new Token("begin", 'Identifier'));
    begin = append(begin, null);
    var _b = parse(tokens, 0), cursor = _b[0], child = _b[1];
    begin = append(begin, child);
    while (cursor !== tokens.length - 1) {
        (_a = parse(tokens, cursor + 1), cursor = _a[0], child = _a[1]);
        begin = append(begin, child);
    }
    var result = evalLisp(begin, new Map);
    console.log(result);
}
main();
