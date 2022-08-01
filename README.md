# Rosetta Stone for Modern Languages

This repo contains implementations of a tree-walking lisp interpreter capable of running the following program:

```lisp
(def fib (lambda (n)
  (if (<= n 2)
      1
      (+ (fib (- n 1)) (fib (- n 2))))))

(fib 12)
```

And it should print out `144` as the result.

### Code golf

This is not code golfing! The idea is to produce some decent idiomatic code for a similar project and compare verbosity. My thesis is that modern Java and C# aren't really that much more verbose than Python or JavaScript. And also that Go is probably more verbose than Java or C#.

## Java

247 lines of code.

```bash
$ cd java
$ javac Main.java
$ java -cp . Main "$(cat ../test.lisp)"
144
```

## C#

246 lines of code.

```bash
$ cd csharp
$ dotnet run "$(cat ../test.lisp)"
144
```

## TypeScript

253 lines of code.

```bash
$ cd typescript
$ yarn
$ yarn tsc lisp.ts
$ node lisp.js "$(cat ../test.lisp)"
144
```

## Go

272 lines of code.

```bash
$ cd go
$ go run lisp.go "$(cat ../test.lisp)"
144
```

## Python

264 lines of code.

```bash
$ cd python
$ python lisp.py "$(cat ../test.lisp)"
144
```

## Ruby

149 lines of code.

```bash
$ cd ruby
$ ruby lisp.rb "$(cat ../test.lisp)"
144
```
