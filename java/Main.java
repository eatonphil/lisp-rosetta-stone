import java.util.function.BiFunction;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.TreeMap;

class Main {
    public enum SexpKind { Atom, Pair };
    public record Sexp(SexpKind kind, Token atom, Pair<Sexp, Sexp> pair) {
	public String pretty() {
	    if (kind == SexpKind.Atom) {
		return atom.value;
	    }

	    if (pair.second() == null) {
		return String.format("(%s . NIL)", pair.first().pretty());
	    }

	    return String.format("(%s . %s)", pair.first().pretty(), pair.second().pretty());
	}

	public static Sexp append(Sexp first, Sexp second) {
	    if (first == null) {
		return new Sexp(SexpKind.Pair, null, new Pair(second, null));
	    }

	    if (first.kind == SexpKind.Atom) {
		return new Sexp(SexpKind.Pair, null, new Pair(first, second));
	    }

	    return new Sexp(SexpKind.Pair, null, new Pair(first.pair.first(), append(first.pair.second(), second)));
	}
    }

    public record Pair<A, B>(A first, B second) {}

    public enum TokenKind {Integer, Identifier, Syntax}
    public record Token(String value, TokenKind kind) {}

    public static void fail(String msg, Object... args) {
	System.err.printf(msg+"\n", args);
	System.exit(1);
    }

    public static Pair<Integer, Token> lexInteger(String program, int cursor) {
	var c = program.charAt(cursor);
	var end = cursor;
	while (c >= '0' && c <= '9') {
	    end++;
	    c = program.charAt(end);
	}

	return new Pair(end, new Token(program.substring(cursor, end), TokenKind.Integer));
    }

    public static Pair<Integer, Token> lexIdentifier(String program, int cursor) {
	var c = program.charAt(cursor);
	var end = cursor;
	while ((c >= 'a' && c <= 'z') ||
	       (c >= 'A' && c <= 'Z') ||
	       (c == '+' || c == '-' || c == '*' || c == '&' || c == '$' || c == '%' || c == '<' || c == '=') ||
	       (end > cursor && c >= '0' && c <= '9')) {
	    end++;
	    c = program.charAt(end);
	}

	return new Pair(end, new Token(program.substring(cursor, end), TokenKind.Identifier));
    }

    public static ArrayList<Token> lex(String program) {
	var tokens = new ArrayList<Token>();
	outer:
	for (var i = 0; i < program.length(); i++) {
	    var c = program.charAt(i);
	    if (c == ' ' || c == '\n' || c == '\t' || c == '\r') {
		continue;
	    }

	    if (c == ')' || c == '(') {
		tokens.add(new Token(Character.toString(c), TokenKind.Syntax));
		continue;
	    }

	    var lexers = new ArrayList<BiFunction<String, Integer, Pair<Integer, Token>>>(Arrays.asList(Main::lexInteger, Main::lexIdentifier));
	    for (var lexer : lexers) {
		Pair<Integer, Token> lexResult = lexer.apply(program, i);
		if (lexResult == null || lexResult.first == i) {
		    continue;
		}

		i = lexResult.first() - 1;
		tokens.add(lexResult.second());
		continue outer;
	    }

	    fail("Unknown token near '%s' at index '%d'", program.substring(i, program.length()), i);
	}

	return tokens;
    }

    public static Pair<Integer, Sexp> parse(ArrayList<Token> tokens, int cursor) {
	Sexp siblings = null;

	if (!tokens.get(cursor).value.equals("(")) {
	    fail("Expected opening parenthesis, got '%s'", tokens.get(cursor).value);
	}

	cursor++;

	for (var t = tokens.get(cursor); cursor < tokens.size(); cursor++, t = tokens.get(cursor)) {
	    if (t.value.equals("(")) {
		var child = parse(tokens, cursor);
		siblings = Sexp.append(siblings, child.second());
		cursor = child.first();
		continue;
	    }

	    if (t.value.equals(")")) {
		return new Pair(cursor, siblings);
	    }

	    var s = new Sexp(SexpKind.Atom, t, null);
	    siblings = Sexp.append(siblings, s);
	}

	return new Pair(cursor, siblings);
    }

    public static ArrayList<Object> evalArgs(Sexp args, TreeMap<String, Object> ctx) {
	var evalledArgs = new ArrayList<Object>();
	while (args != null) {
	    evalledArgs.add(eval(args.pair.first(), ctx));
	    args = args.pair.second();
	}
	return evalledArgs;
    }

    public static Object eval(Sexp ast, TreeMap<String, Object> ctx) {
	if (ast.kind == SexpKind.Pair) {
	    var fn = (BiFunction<Sexp, TreeMap<String, Object>, Object>)eval(ast.pair.first(), ctx);
	    if (fn == null) {
		fail("Unknown function: %s", ast.pair.first().pretty());
		return null;
	    }
	    var args = ast.pair.second();
	    return fn.apply(args, ctx);
	}

	if (ast.atom.kind == TokenKind.Integer) {
	    return Integer.parseInt(ast.atom.value);
	}

	var value = ctx.get(ast.atom.value);
	if (value != null) {
	    return value;
	}

	BiFunction<Sexp, TreeMap<String, Object>, Object> function = (args, ignore) -> switch (ast.atom.value) {
	case "<=" -> {
	    var evalledArgs = evalArgs(args, ctx);
	    yield (Integer)evalledArgs.get(0) <= (Integer)evalledArgs.get(1);
	}
	case "if" -> {
	    var test = eval(args.pair.first(), ctx);
	    if ((Boolean)test) {
		yield eval(args.pair.second().pair.first(), ctx);
	    } else {
		yield eval(args.pair.second().pair.second().pair.first(), ctx);
	    }
	}
	case "def" -> {
	    var evalledArg = eval(args.pair.second().pair.first(), ctx);
	    ctx.put(args.pair.first().atom.value, evalledArg);
	    yield evalledArg;
	}
	case "lambda" -> {
	    var params = args.pair.first();
	    var body = args.pair.second();

	    BiFunction<Sexp, TreeMap<String, Object>, Object> lambda = (callArgs, callCtx) -> {
		var evalledCallArgs = evalArgs(callArgs, callCtx);
		var childCallCtx = (TreeMap<String, Object>)callCtx.clone();
		var iter = params;
		var i = 0;
		while (iter != null) {
		    childCallCtx.put(iter.pair.first().atom.value, evalledCallArgs.get(i));
		    i++;
		    iter = iter.pair.second();
		}

		var begin = new Sexp(SexpKind.Atom, new Token("begin", TokenKind.Identifier), null);
		begin = Sexp.append(begin, body);
		return eval(begin, childCallCtx);
	    };

	    yield lambda;
	}
	case "begin" -> {
	    Object res = null;
	    while (args != null) {
		res = eval(args.pair.first(), ctx);
		args = args.pair.second();
	    }

	    yield res;
	}
	case "+" -> {
	    var res = 0;
	    for (var arg : evalArgs(args, ctx)) {
		res += (Integer)arg;
	    }

	    yield res;
	}
	case "-" -> {
	    var evalledArgs = evalArgs(args, ctx);
	    var res = (Integer)evalledArgs.get(0);
	    var rest = evalledArgs.subList(1, evalledArgs.size());
	    for (var arg : rest) {
		res -= (Integer)arg;
	    }
	    yield res;
	}
	default -> {
	    fail("Undefined value: %s", ast.atom.value);
	    yield null;
	}
	};

	return (Object)function;
    }

    public static void main(String[] args) {
	var program = args[0];
	var tokens = lex(program);
	var begin = new Sexp(SexpKind.Atom, new Token("begin", TokenKind.Identifier), null);
	begin = Sexp.append(begin, null);
	var parsed = parse(tokens, 0);
	begin = Sexp.append(begin, parsed.second());
	while (parsed.first() != tokens.size() - 1) {
	    parsed = parse(tokens, parsed.first()+1);
	    begin = Sexp.append(begin, parsed.second());
	}
	var result = eval(begin, new TreeMap<String, Object>());
	System.out.println(result);
    }
}
