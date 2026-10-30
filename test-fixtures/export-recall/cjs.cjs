"use strict";

function foo() {
  return "foo";
}

class Bar {
  run() {
    return true;
  }
}

module.exports.foo = foo;
module.exports.Bar = Bar;
