using System;
using System.Collections;
using System.Collections.Generic;

var program = args[0];
var tokens = Lex(program);
var begin = new Sexp(SexpKind.Atom, new Token("begin", TokenKind.Identifier), null);
begin = Sexp.Append(begin, null);
(var cursor, var child) = Parse(tokens, 0);
begin = Sexp.Append(begin, child);
while (cursor != tokens.Count - 1) {
    (cursor, child) = Parse(tokens, cursor+1);
    begin = Sexp.Append(begin, child);
}
var result = Eval(begin, new Dictionary<String, object>());
Console.Out.WriteLine(result);

void Fail(String msg, params object[] args) {
    Console.Out.Write(msg+"\n", args);
    Environment.Exit(1);
}

Tuple<int, Token> LexInteger(String program, int cursor) {
    var c = program[cursor];
    var end = cursor;
    while (c >= '0' && c <= '9') {
	end++;
	c = program[end];
    }

    return Tuple.Create(end, new Token(program.Substring(cursor, end-cursor), TokenKind.Integer));
}

Tuple<int, Token> LexIdentifier(String program, int cursor) {
    var c = program[cursor];
    var end = cursor;
    while ((c >= 'a' && c <= 'z') ||
	   (c >= 'A' && c <= 'Z') ||
	   (c == '+' || c == '-' || c == '*' || c == '&' || c == '$' || c == '%' || c == '<' || c == '=') ||
	   (end > cursor && c >= '0' && c <= '9')) {
	end++;
	c = program[end];
    }

    return Tuple.Create(end, new Token(program.Substring(cursor, end-cursor), TokenKind.Identifier));
}

List<Token> Lex(String program) {
    var tokens = new List<Token>();
    for (var i = 0; i < program.Length; i++) {
	var c = program[i];
	if (c == ' ' || c == '\n' || c == '\t' || c == '\r') {
	    continue;
	}

	if (c == ')' || c == '(') {
	    tokens.Add(new Token(c.ToString(), TokenKind.Syntax));
	    continue;
	}

	var lexers = new List<Func<String, int, Tuple<int, Token>>>{LexInteger, LexIdentifier};
	var found = false;
	foreach (var lexer in lexers) {
	    (var cursor, var token) = lexer(program, i);
	    if (cursor == i) {
		continue;
	    }

	    i = cursor - 1;
	    tokens.Add(token);
	    found = true;
	    break;
	}

	if (!found) {
	    Console.Out.WriteLine(i);
	    Console.Out.WriteLine(program.Length);
	    Fail("Unknown token near '%s' at index '%d'", program.Substring(i, Math.Min(program.Length - i, 10)), i);
	}
    }
    
    return tokens;
}

Tuple<int, Sexp> Parse(List<Token> tokens, int cursor) {
    Sexp siblings = null;

    if (!tokens[cursor].value.Equals("(")) {
	Fail("Expected opening parenthesis, got '%s'", tokens[cursor].value);
    }

    cursor++;

    for (var t = tokens[cursor]; cursor < tokens.Count; cursor++, t = tokens[cursor]) {
	if (t.value.Equals("(")) {
	    var child = Parse(tokens, cursor);
	    siblings = Sexp.Append(siblings, child.Item2);
	    cursor = child.Item1;
	    continue;
	}

	if (t.value.Equals(")")) {
	    return Tuple.Create(cursor, siblings);
	}

	var s = new Sexp(SexpKind.Atom, t, null);
	siblings = Sexp.Append(siblings, s);
    }

    return Tuple.Create(cursor, siblings);
}

List<object> EvalArgs(Sexp args, Dictionary<String, object> ctx) {
    var evalledArgs = new List<object>();
    while (args != null) {
	evalledArgs.Add(Eval(args.pair.Item1, ctx));
	args = args.pair.Item2;
    }
    return evalledArgs;
}

object Eval(Sexp ast, Dictionary<String, object> ctx) {
    if (ast.kind == SexpKind.Tuple) {
	var fn = (Func<Sexp, Dictionary<String, object>, object>)Eval(ast.pair.Item1, ctx);
	if (fn == null) {
	    Fail("Unknown function: %s", ast.pair.Item1.Pretty());
	    return null;
	}
	var args = ast.pair.Item2;
	return fn(args, ctx);
    }

    if (ast.atom.kind == TokenKind.Integer) {
	return Int32.Parse(ast.atom.value);
    }

    if (ctx.ContainsKey(ast.atom.value)) {
	return ctx[ast.atom.value];
    }

    Func<Sexp, Dictionary<String, object>, object> function = (args, ignore) => {
	switch (ast.atom.value) {
	    case "<=": {
		var evalledArgs = EvalArgs(args, ctx);
		return (int)evalledArgs[0] <= (int)evalledArgs[1];
	    }
	    case "if": {
		var test = Eval(args.pair.Item1, ctx);
		if ((Boolean)test) {
		    return Eval(args.pair.Item2.pair.Item1, ctx);
		}

		return Eval(args.pair.Item2.pair.Item2.pair.Item1, ctx);
	    }
	    case "def": {
		var evalledArg = Eval(args.pair.Item2.pair.Item1, ctx);
		ctx[args.pair.Item1.atom.value] = evalledArg;
		return evalledArg;
	    }
	    case "lambda": {
		(var parameters, var body) = args.pair;

		Func<Sexp, Dictionary<String, object>, object> lambda = (callArgs, callCtx) => {
		    var evalledCallArgs = EvalArgs(callArgs, callCtx);
		    var childCallCtx = new Dictionary<String, object>(callCtx);
		    var iter = parameters;
		    var i = 0;
		    while (iter != null) {
			childCallCtx[iter.pair.Item1.atom.value] = evalledCallArgs[i];
			i++;
			iter = iter.pair.Item2;
		    }

		    var begin = new Sexp(SexpKind.Atom, new Token("begin", TokenKind.Identifier), null);
		    begin = Sexp.Append(begin, body);
		    return Eval(begin, childCallCtx);
		};

		return lambda;
	    }
	    case "begin": {
		object res = null;
		while (args != null) {
		    res = Eval(args.pair.Item1, ctx);
		    args = args.pair.Item2;
		}

		return res;
	    }
	    case "+": {
		var res = 0;
		foreach (var arg in EvalArgs(args, ctx)) {
		    res += (int)arg;
		}

		return res;
	    }
	    case "-": {
		var evalledArgs = EvalArgs(args, ctx);
		var res = (int)evalledArgs[0];
		var rest = evalledArgs.GetRange(1, evalledArgs.Count-1);
		foreach (var arg in rest) {
		    res -= (int)arg;
		}
		return res;
	    }
	    default: {
		Fail("Undefined value: %s", ast.atom.value);
		return null;
	    }
	}
    };
    
    return (object)function;
}


enum TokenKind {Integer, Identifier, Syntax}
record Token(String value, TokenKind kind) {}

enum SexpKind { Atom, Tuple };
record Sexp(SexpKind kind, Token atom, Tuple<Sexp, Sexp> pair) {
    public String Pretty() {
	if (kind == SexpKind.Atom) {
	    return atom.value;
	}

	if (pair.Item2 == null) {
	    return $"({pair.Item1.Pretty()} . NIL)";
	}

	return $"({pair.Item1.Pretty()} . {pair.Item2.Pretty()})";
    }

    public static Sexp Append(Sexp first, Sexp second) {
	if (first == null) {
	    return new Sexp(SexpKind.Tuple, null, Tuple.Create<Sexp, Sexp>(second, null));
	}

	if (first.kind == SexpKind.Atom) {
	    return new Sexp(SexpKind.Tuple, null, Tuple.Create(first, second));
	}

	return new Sexp(SexpKind.Tuple, null, Tuple.Create(first.pair.Item1, Append(first.pair.Item2, second)));
    }
}
