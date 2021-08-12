(def sum (lambda (a b) (+ a b)))

(def ft 14)

(def fib (lambda (n)
  (if (<= n 2)
      1
      (+ (fib (- n 1)) (fib (- n 2))))))

(sum 12 (- ft 2))

(fib 12)
