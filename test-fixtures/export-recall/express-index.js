"use strict";

function createApplication() {
  return { use() {}, listen() {} };
}

function json() {
  return null;
}

function Router() {
  return {};
}

function serveStatic() {
  return null;
}

module.exports = createApplication;
exports.application = createApplication;
exports.json = json;
exports.Router = Router;
exports.static = serveStatic;
