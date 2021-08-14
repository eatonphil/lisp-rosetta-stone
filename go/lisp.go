package main

import (
	"fmt"
	"os"
	"strconv"
)

type Sexp interface {
	eval(ctx Ctx) interface{}
}

type Atom Token
type Pair struct {
	car Sexp
	cdr Sexp
}

func (a Atom) String() string {
	return a.value
}

func (p Pair) String() string {
	return fmt.Sprintf("(%s . %s)", p.car, p.cdr)
}

func sexpAppend(first Sexp, second Sexp) Sexp {
	switch first := first.(type) {
	case Atom:
		return Pair{first, second}
	case Pair:
		return Pair{first.car, sexpAppend(first.cdr, second)}
	default:
		return Pair{second, nil}
	}
}

type TokenKind uint

const (
	Integer TokenKind = iota
	Identifier
	Syntax
)

type Token struct {
	value string
	kind  TokenKind
}

func lexInteger(program string, cursor int) (int, Token) {
	c := program[cursor]
	end := cursor
	for c >= '0' && c <= '9' {
		end++
		c = program[end]
	}

	return end, Token{program[cursor:end], Integer}
}

func lexIdentifier(program string, cursor int) (int, Token) {
	c := program[cursor]
	end := cursor
	for (c >= 'a' && c <= 'z') ||
		(c >= 'A' && c <= 'Z') ||
		(c == '+' || c == '-' || c == '*' || c == '&' || c == '$' || c == '%' || c == '<' || c == '=') ||
		(end > cursor && c >= '0' && c <= '9') {
		end++
		c = program[end]
	}

	return end, Token{program[cursor:end], Identifier}
}

func lex(program string) []Token {
	var tokens []Token
outer:
	for i := 0; i < len(program); i++ {
		c := program[i]
		if c == ' ' || c == '\n' || c == '\t' || c == '\r' {
			continue
		}

		if c == ')' || c == '(' {
			tokens = append(tokens, Token{string(c), Syntax})
			continue
		}

		lexers := []func(string, int) (int, Token){lexInteger, lexIdentifier}
		for _, lexer := range lexers {
			newCursor, token := lexer(program, i)
			if newCursor == i {
				continue
			}

			i = newCursor - 1
			tokens = append(tokens, token)
			continue outer
		}

		panic(fmt.Sprintf("Unknown token near '%s' at index '%d'", program[i:], i))
	}

	return tokens
}

func parse(tokens []Token, cursor int) (int, Sexp) {
	var siblings Sexp = nil

	if tokens[cursor].value != "(" {
		panic("Expected opening parenthesis, got: " + tokens[cursor].value)
	}

	cursor++

	for ; cursor < len(tokens); cursor++ {
		t := tokens[cursor]
		if t.value == "(" {
			newCursor, child := parse(tokens, cursor)
			siblings = sexpAppend(siblings, child)
			cursor = newCursor
			continue
		}

		if t.value == ")" {
			return cursor, siblings
		}

		s := Atom(t)
		siblings = sexpAppend(siblings, s)
	}

	return cursor, siblings
}

func evalLispArgs(args Sexp, ctx Ctx) []interface{} {
	if p, ok := args.(Pair); ok {
		return append([]interface{}{p.car.eval(ctx)}, evalLispArgs(p.cdr, ctx)...)
	}
	return nil
}

type Ctx map[string]interface{}

func (p Pair) eval(ctx Ctx) interface{} {
	if fn, ok := p.car.eval(ctx).(func(args Sexp, _ Ctx) interface{}); ok {
		return fn(p.cdr, ctx)
	}
	panic(fmt.Sprintf("Unknown func: %s", p.car))
}

func (a Atom) eval(ctx Ctx) interface{} {
	if a.kind == Integer {
		i, _ := strconv.Atoi(a.value)
		return i
	}

	if value, ok := ctx[a.value]; ok {
		return value
	}

	switch a.value {
	case "<=":
		return func(args Sexp, _ Ctx) interface{} {
			evalledArgs := evalLispArgs(args, ctx)
			return evalledArgs[0].(int) <= evalledArgs[1].(int)
		}
	case "if":
		return func(args Sexp, _ Ctx) interface{} {
			p := args.(Pair)
			test := p.car.eval(ctx)
			if test.(bool) {
				return p.cdr.(Pair).car.eval(ctx)
			}
			return p.cdr.(Pair).cdr.(Pair).car.eval(ctx)
		}
	case "def":
		return func(args Sexp, _ Ctx) interface{} {
			p := args.(Pair)
			evalledArg := p.cdr.(Pair).car.eval(ctx)
			ctx[p.car.(Atom).value] = evalledArg
			return evalledArg
		}
	case "lambda":
		return func(args Sexp, _ Ctx) interface{} {
			p := args.(Pair)
			params := p.car
			body := p.cdr

			return func(callArgs Sexp, callCtx Ctx) interface{} {
				evalledCallArgs := evalLispArgs(callArgs, callCtx)
				childCallCtx := Ctx{}
				for key, val := range callCtx {
					childCallCtx[key] = val
				}

				iter := params
				for i := 0; iter != nil; i++ {
					childCallCtx[iter.(Pair).car.(Atom).value] = evalledCallArgs[i]
					iter = iter.(Pair).cdr
				}

				var begin Sexp = Atom(Token{"begin", Identifier})
				begin = sexpAppend(begin, body)
				return begin.eval(childCallCtx)
			}
		}
	case "begin":
		return func(args Sexp, _ Ctx) interface{} {
			res := evalLispArgs(args, ctx)
			return res[len(res)-1]
		}
	case "+":
		return func(args Sexp, _ Ctx) interface{} {
			res := 0
			for _, arg := range evalLispArgs(args, ctx) {
				res += arg.(int)
			}

			return res
		}
	case "-":
		return func(args Sexp, _ Ctx) interface{} {
			var evalledArgs = evalLispArgs(args, ctx)
			var res = evalledArgs[0].(int)
			var rest = evalledArgs[1:]
			for _, arg := range rest {
				res -= arg.(int)
			}
			return res
		}
	default:
		panic("Undefined value :" + a.value)
	}
}

func main() {
	program := os.Args[1]
	tokens := lex(program)
	var begin Sexp = Atom(Token{"begin", Identifier})
	begin = sexpAppend(begin, nil)
	cursor, child := parse(tokens, 0)
	begin = sexpAppend(begin, child)
	for cursor != len(tokens)-1 {
		cursor, child = parse(tokens, cursor+1)
		begin = sexpAppend(begin, child)
	}
	result := begin.eval(Ctx{})
	fmt.Println(result)
}
