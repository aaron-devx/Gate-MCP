"use strict";

var methods = ["get", "post", "put"];

var app = function app() {};

methods.forEach(function (method) {
  app[method] = function (path) {
    return path;
  };
});

app.use = function use(fn) {
  return fn;
};

module.exports = app;
