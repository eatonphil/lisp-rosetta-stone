class Atom
  attr_reader :token

  def initialize(token)
    @token = token
  end

  def deconstruct = [token]
  def pretty = token.value
end

class Pair
  attr_reader :left, :right

  def initialize(left, right)
    @left = left
    @right = right
  end

  def deconstruct = [left, right]
  def pretty = "(#{left.pretty} . #{right&.pretty || "NIL"})"
end

def lex(program)
  Enumerator.new do |enum|
    index = 0

    while index < program.length
      case program[index..]
      when /\A[ \n\t\r]+/
        index += $&.length
      when /\A[\(\)]/
        enum << $&.to_sym
        index += 1
      when /\A\d+/
        enum << $&.to_i
        index += $&.length
      when /\A[a-zA-Z+\-*&$%<=][a-zA-Z+\-*&$%<=0-9]*/
        enum << $&
        index += $&.length
      else
        raise "Unknown token near '%s' at index '%d'" % [program[index..], index]
      end
    end

    enum << :EOF
  end
end

def append(left, right)
  case left
  in nil
    Pair.new(right, nil)
  in Atom
    Pair.new(left, right)
  in Pair[left_left, left_right]
    Pair.new(left_left, append(left_right, right))
  end
end

def parse(tokens)
  unless (token = tokens.next) == :"("
    raise "Expected opening parenthesis, got: #{token}"
  end

  siblings = nil

  while (token = tokens.peek) != :EOF
    case token
    in :"("
      siblings = append(siblings, parse(tokens))
    in :")"
      tokens.next
      return siblings
    else
      siblings = append(siblings, Atom.new(tokens.next))
    end
  end

  siblings
end

def arguments(args, ctx)
  result = []
  while args in Pair[arg, args]
    result << evaluate(arg, ctx)
  end

  result
end

def evaluate(sexp, ctx)
  case sexp
  in Pair[left, right]
    callable = evaluate(left, ctx) or raise "Unknown def: #{left.pretty}"
    callable.call(right, ctx)
  in Atom[Integer => value]
    value
  in Atom[value] if ctx.key?(value)
    ctx[value]
  in Atom["if"]
    ->(node, ctx) {
      node => Pair[predicate, Pair[truthy, Pair[falsy, nil]]]
      evaluate(evaluate(predicate, ctx) ? truthy : falsy, ctx)
    }
  in Atom["def"]
    ->(node, ctx) {
      node => Pair[Atom[name], Pair[body, nil]]
      ctx[name] = evaluate(body, ctx)
    }
  in Atom["lambda"]
    ->(node, ctx) {
      node => Pair[params, body]
  
      ->(args, parent_ctx) {
        call_values = arguments(args, parent_ctx)
        call_ctx = parent_ctx.dup

        pair = params
        while pair in Pair[Atom[name], pair]
          call_ctx[name] = call_values.shift
        end
  
        evaluate(append(Atom.new("begin"), body), call_ctx)
      }
    }
  in Atom["begin"]
    ->(stmts, ctx) {
      result = nil
      while stmts in Pair[stmt, stmts]
        result = evaluate(stmt, ctx)
      end
      result
    }
  in Atom["<="]
    ->(args, ctx) { arguments(args, ctx).inject(:<=) }
  in Atom["+"]
    ->(args, ctx) { arguments(args, ctx).inject(:+) }
  in Atom["-"]
    ->(args, ctx) { arguments(args, ctx).inject(:-) }
  else
    raise "Undefined value: #{value}"
  end
end

tokens = lex(ARGV.first)
root = append(Atom.new("begin"), nil)
root = append(root, parse(tokens)) while tokens.peek != :EOF
puts evaluate(root, {})
