# Rosetta Stone for Modern Languages

## Java

```bash
$ cd java
$ javac Main.java
$ java -cp . Main "$(cat ../test.lisp)"
144
```

## C#

```bash
$ cd csharp
$ dotnet Main.cs
$ ./a.out "$(cat ../test.lisp)"
```

## TypeScript

```bash
$ cd typescript
$ yarn
$ yarn tsc lisp.ts
$ node lisp.js "$(cat ../test.lisp)"
144
```
