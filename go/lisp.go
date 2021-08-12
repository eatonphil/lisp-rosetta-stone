package main

import (
	"fmt"
	"strconv"
	"os"
)

type SexpKind uint

const (
	Atom SexpKind = iota
	Pair
)

type Sexp struct {
	kind SexpKind
	atom *Token
	pair *struct {
		car Sexp
		cdr *Sexp
	}
}

func (s Sexp) pretty() string {
	if s.kind == Atom {
		return s.atom.value
	}

	if s.pair.cdr == nil {
		return fmt.Sprintf("(%s . NIL)", s.pair.car.pretty())
	}

	return fmt.Sprintf("(%s . %s)", s.pair.car.pretty(), s.pair.cdr.pretty())
}

func sexpAppend(first *Sexp, second *Sexp) Sexp {
	if first == nil {
		return Sexp{Pair, nil, &struct{car Sexp; cdr *Sexp}{*second, nil}}
	}

	if first.kind == Atom {
		return Sexp{Pair, nil, &struct{car Sexp; cdr *Sexp}{*first, second}}
	}

	appended := sexpAppend(first.pair.cdr, second)
	return Sexp{Pair, nil, &struct{car Sexp; cdr *Sexp}{first.pair.car, &appended}}
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

		lexers := []func(string, int)(int, Token){lexInteger, lexIdentifier}
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
	var siblings *Sexp = nil

	if tokens[cursor].value != "(" {
		panic("Expected opening parenthesis, got: " + tokens[cursor].value)
	}

	cursor++

	for ; cursor < len(tokens); cursor++ {
		t := tokens[cursor]
		if t.value == "(" {
			newCursor, child := parse(tokens, cursor)
			appended := sexpAppend(siblings, &child)
			siblings = &appended
			cursor = newCursor
			continue
		}

		if t.value == ")" {
			return cursor, *siblings
		}

		s := Sexp{Atom, &t, nil}
		appended := sexpAppend(siblings, &s)
		siblings = &appended
	}

	return cursor, *siblings
}

func evalLispArgs(args Sexp, ctx map[string]interface{}) []interface{} {
	var evalledArgs []interface{}
	iter := &args
	for iter != nil {
		evalledArgs = append(evalledArgs, evalLisp(iter.pair.car, ctx))
		iter = iter.pair.cdr
	}
	return evalledArgs
}

func evalLisp(ast Sexp, ctx map[string]interface{}) interface{} {
	if ast.kind == Pair {
		fn := evalLisp(ast.pair.car, ctx)
		if fn == nil {
			panic(fmt.Sprintf(("Unknown func: " + ast.pair.car.pretty())))
		}
		return fn.(func(Sexp, map[string]interface{})interface{})(*ast.pair.cdr, ctx)
	}

	if ast.atom.kind == Integer {
		i, _ := strconv.Atoi(ast.atom.value)
		return i
	}

	value, ok := ctx[ast.atom.value]
	if ok {
		return value
	}

	var builtins = map[string]func(Sexp, map[string]interface{}) interface{}{
		"<=": func(args Sexp, _ map[string]interface{}) interface{} {
			evalledArgs := evalLispArgs(args, ctx)
			return evalledArgs[0].(int) <= evalledArgs[1].(int)
		},
		"if": func(args Sexp, _ map[string]interface{}) interface{} {
			test := evalLisp(args.pair.car, ctx)
			if test.(bool) {
				return evalLisp(args.pair.cdr.pair.car, ctx)
			}

			return evalLisp(args.pair.cdr.pair.cdr.pair.car, ctx)
		},
		"def": func(args Sexp, _ map[string]interface{}) interface{} {
			evalledArg := evalLisp(args.pair.cdr.pair.car, ctx)
			ctx[args.pair.car.atom.value] = evalledArg
			return evalledArg
		},
		"lambda": func(args Sexp, _ map[string]interface{}) interface{} {
			params := args.pair.car
			body := args.pair.cdr

			return func(callArgs Sexp, callCtx map[string]interface{}) interface{} {
				evalledCallArgs := evalLispArgs(callArgs, callCtx)
				childCallCtx := map[string]interface{}{}
				for key, val := range callCtx {
					childCallCtx[key] = val
				}

				iter := &params
				i := 0
				for iter != nil {
					childCallCtx[iter.pair.car.atom.value] = evalledCallArgs[i]
					i++
					iter = iter.pair.cdr
				}

				begin := Sexp{Atom, &Token{"begin", Identifier}, nil}
				begin = sexpAppend(&begin, body)
				return evalLisp(begin, childCallCtx)
			}
		},
		"begin": func(args Sexp, _ map[string]interface{}) interface{} {
			var res interface{}
			iter := &args
			for iter != nil {
				res = evalLisp(iter.pair.car, ctx)
				iter = iter.pair.cdr
			}

			return res
		},
		"+": func(args Sexp, _ map[string]interface{}) interface{} {
			res := 0
			for _, arg := range evalLispArgs(args, ctx) {
				res += arg.(int)
			}

			return res
		},
		"-": func(args Sexp, _ map[string]interface{}) interface{} {
			var evalledArgs = evalLispArgs(args, ctx)
			var res = evalledArgs[0].(int)
			var rest = evalledArgs[1:]
			for _, arg := range rest {
				res -= arg.(int)
			}
			return res
		},
	}

	value, ok = builtins[ast.atom.value]
	if !ok {
		panic("Undefined value :" + ast.atom.value)
	}

	return value
}

func main() {
	program := os.Args[1]
	tokens := lex(program)
	begin := Sexp{Atom, &Token{"begin", Identifier}, nil}
	begin = sexpAppend(&begin, nil)
	cursor, child := parse(tokens, 0)
	begin = sexpAppend(&begin, &child)
	for cursor != len(tokens)-1 {
		cursor, child = parse(tokens, cursor+1)
		begin = sexpAppend(&begin, &child)
	}
	result := evalLisp(begin, map[string]interface{}{})
	fmt.Println(result)
}
