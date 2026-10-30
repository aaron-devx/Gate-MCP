"use strict";

var res = {};

res.contentType =
res.type = function contentType(type) {
  return type;
};

res.set =
res.header = function header(field, val) {
  return val;
};

module.exports = res;
