enum TokenKind: Int, RawRepresentable {
    case integer, identifier, syntax
}

struct Token {
    let value: Substring
    let kind: TokenKind
}

enum Sexp {
    case atom(Token)
    indirect case pair(Sexp?, Sexp?)

    var atom: Token? { guard case let .atom(token) = self else { return nil } ; return token }
    var pair: (Sexp?, Sexp?)? { guard case let .pair(car, cdr) = self else { return nil } ; return (car, cdr) }

    var pretty: Substring {
        if case let .atom(token) = self {
            return token.value
        }
        guard case let .pair(car, cdr) = self else { fatalError() }
        return "(\(car?.pretty ?? "nil") . \(cdr?.pretty ?? "nil"))"
    }
}

func sexpAppend(first: Sexp? = nil, second: Sexp? = nil) -> Sexp {
    guard let first = first else {
        return .pair(second, nil)
    }
    if case let .pair(car, cdr) = first {
        let appended = sexpAppend(first: cdr, second: second)
        return .pair(car, appended)
    }
    return .pair(first, second)
}

func lexInteger(_ program: String, cursor: String.Index) -> (String.Index, Token) {
    var c = program[cursor]
    var end = cursor
    while c.isWholeNumber {
        end = program.index(after: end)
        c = program[end]
    }
    return (end, Token(value: program[cursor..<end], kind: .integer))
}

func lexIdentifier(_ program: String, cursor: String.Index) -> (String.Index, Token) {
    var c = program[cursor]
    var end = cursor
    while c.isLetter ||
          ["+", "-", "*", "&", "$", "%", "<", "="].contains(c) ||
            ( end != cursor && c.isWholeNumber ) {
        end = program.index(after: end)
        guard end != program.endIndex else { break }
        c = program[end]
    }
    return (end, Token(value: program[cursor..<end], kind: .identifier))
}

func lex(_ program: String) -> [Token] {
    var tokens = [Token]()
    var i = program.startIndex
    while i != program.endIndex {
        let c = program[i]
        guard !c.isWhitespace && !c.isNewline else { i = program.index(after: i) ; continue }
        if c == ")" || c == "(" {
            tokens.append(Token(value: program[i...i], kind: .syntax))
            i = program.index(after: i)
            continue
        }
        var found = false
        for lexer in [lexInteger, lexIdentifier] {
            let (newCursor, token) = lexer(program, i)
            found = newCursor != i
            guard found else { continue }
            i = newCursor
            tokens.append(token)
            break
        }
        guard found else {
            fatalError("Unknown token near '\(program[i...])' at index \(i)")
        }
    }
    return tokens
}

func parse(_ tokens: [Token], cursor: Int = 0) -> (Int, Sexp?) {
    var siblings = Optional<Sexp>.none
    guard cursor >= tokens.count || tokens[cursor].value == "(" else {
        fatalError("Expected opening parenthesis, got: '\(tokens[cursor].value)'")
    }
    var cursor = cursor + 1
    while cursor < tokens.count {
        let t = tokens[cursor]
        switch t.value {
        case "(":
            let (newCursor, child) = parse(tokens, cursor: cursor)
            siblings = sexpAppend(first: siblings, second: child)
            cursor = newCursor
        case ")":
            return (cursor, siblings)
        default:
            siblings = sexpAppend(first: siblings, second: .atom(t))
        }
        cursor += 1
    }
    return (cursor, siblings)
}

func evalLisp(args: Sexp?, context ctx: inout [Substring : Any]) -> [Any?] {
    var evalledArgs = [Any?]()
    var iter = args
    while let args = iter {
        guard case let .pair(car, cdr) = args else { break }
        evalledArgs.append(evalLisp(ast: car, context: &ctx))
        iter = cdr
    }
    return evalledArgs
}

let builtins: [Substring : Any] = [
    "<=" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        let evalledArgs = evalLisp(args: args, context: &ctx)
        guard let lhs = evalledArgs.first as? Int, evalledArgs.count > 1,
              let rhs = evalledArgs[1] as? Int else { return nil }
        return lhs <= rhs
    },
    "if" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        let test = evalLisp(ast: args?.pair?.0, context: &ctx) as? Bool ?? false
        return test ?
            evalLisp(ast: args?.pair?.1?.pair?.0, context: &ctx) :
            evalLisp(ast: args?.pair?.1?.pair?.1, context: &ctx)
    },
    "def" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        guard let name = args?.pair?.0?.atom?.value,
              let evalledArg = evalLisp(ast: args?.pair?.1?.pair?.0, context: &ctx) else { return nil }
        ctx[name] = evalledArg
        return evalledArg
    },
    "lambda" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        guard let params = args?.pair?.0, let body = args?.pair?.1 else { return nil }
        return { (callArgs: Sexp?, callCtx: inout [Substring : Any]) -> Any? in
            let evalledCallArgs = evalLisp(args: callArgs, context: &callCtx)
            var childCallCtx = callCtx
            var iter: Sexp? = params
            var i = 0
            while let arg = iter {
                if let name = arg.pair?.0?.atom?.value {
                    childCallCtx[name] = evalledCallArgs[i]
                }
                i += 1
                iter = arg.pair?.1
            }
            let begin = sexpAppend(first: .atom(Token(value: "begin", kind: .identifier)), second: body)
            return evalLisp(ast: begin, context: &childCallCtx)
        }
    },
    "begin" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        var res: Any?
        var iter = args
        while let arg = iter {
            res = evalLisp(ast: arg.pair?.0, context: &ctx)
            iter = arg.pair?.1
        }
        return res
    },
    "+" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        evalLisp(args: args, context: &ctx).reduce(0) {
            $0 + (($1 as? Int) ?? 0)
        }
    },
    "-" : { (args: Sexp?, ctx: inout [Substring : Any]) -> Any? in
        let evalledArgs = evalLisp(args: args, context: &ctx)
        return evalledArgs[1..<evalledArgs.endIndex].reduce(evalledArgs.first as? Int ?? 0) {
            $0 - (($1 as? Int) ?? 0)
        }
    }
]

func evalLisp(ast: Sexp?, context ctx: inout [Substring : Any]) -> Any? {
    switch ast {
    case let .pair(car, cdr):
        let value = evalLisp(ast: car, context: &ctx)
        guard let fn = value as? (Sexp?, inout [Substring : Any]) -> Any? else { return value }
        return fn(cdr, &ctx)
    case let .atom(token):
        switch token.kind {
        case .integer: return Int(token.value)
        default:
            guard let value = ctx[token.value] ?? builtins[token.value] else {
                fatalError("Undefined value :" + token.value)
            }
            return value
        }
    default: return nil
    }
}

let program = CommandLine.arguments[1]
let tokens = lex(program)
var begin = sexpAppend(first: .atom(Token(value: "begin", kind: .identifier)))
var (cursor, child) = parse(tokens)
begin = sexpAppend(first: begin, second: child)
while cursor < tokens.count-1 {
    (cursor, child) = parse(tokens, cursor: cursor+1)
    begin = sexpAppend(first: begin, second: child)
}
var ctx = builtins
if let result = evalLisp(ast: begin, context: &ctx) {
    print(result)
}
