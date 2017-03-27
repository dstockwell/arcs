// @license
// Copyright (c) 2017 Google Inc. All rights reserved.
// This code may only be used under the BSD style license found at
// http://polymer.github.io/LICENSE.txt
// Code distributed by Google as part of this project is also
// subject to an additional IP rights grant found at
// http://polymer.github.io/PATENTS.txt
'use strict';

const assert = require('assert');
const Identifier = require('./identifier.js');
const Symbols = require('./symbols.js');
const Entity = require('./entity.js');
const Relation = require('./relation.js');
let identifier = Symbols.identifier;
const tracing = require("../tracelib/trace.js");

// TODO: This won't be needed once runtime is transferred between contexts.
function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function restore(entry, scope) {
  let {id, data} = entry;
  var entity = Entity.fromLiteral(id, cloneData(data));
  var type = scope.typeFor(entity);
  entity.constructor = type.entityClass;
  // TODO: Relation magic should happen elsewhere, and be better.
  if (scope.typeFor(entity).isRelation) {
    let ids = data.map(literal => Identifier.fromLiteral(literal, scope));
    let entities = ids.map(id => scope._viewFor(id.type.viewOf(scope)).get(id));
    assert(!entities.includes(undefined));
    entity = new Relation(...entities);
    entity.entities = entities;
    entity[identifier] = id;
  }
  return entity;
}

class ViewBase {
  constructor(type, scope) {
    this._type = type;
    this._scope = scope;
    this._listeners = new Map();
    this._listenersCheckpoint = null;
    this._version = 0;
    this._versionCheckpoint = null;
    this._checkpointed = false;
    this._pendingCallbacks = 0;
  }
  get type() {
    return this._type;
  }
  // TODO: add 'once' which returns a promise.
  on(kind, callback, trigger) {
    let listeners = this._listeners.get(kind) || new Map();
    listeners.set(callback, -Infinity);
    this._listeners.set(kind, listeners);
    if (trigger) {
      this._fire(kind);
    }
  }
  _mutate() {
    this._version++;
  }
  _fire(kind, details) {
    let listeners = Array.from((this._listeners.get(kind) || new Map()).keys())
    if (this._pendingCallbacks == 0 && this._dirty) {
      this._dirty();
    }
    this._pendingCallbacks++;
    Promise.resolve().then(() => {
      let listenerVersions = this._listeners.get(kind);
      for (let listener of listeners) {
        let version = listenerVersions.get(listener);
        if (version < this._version) {
          listenerVersions.set(listener, this._version);
          listener(this, details);
        }
      }
      this._pendingCallbacks--;
      if (this._pendingCallbacks == 0 && this._clean) {
        this._clean();
      }
    });
  }
  _serialize(entity) {
    let id = entity[identifier];
    let data = cloneData(entity.toLiteral());
    return {
      id,
      data: data,
    };
  }
  _restore(entry) {
    return restore(entry, this._scope);
  }
  checkpoint() {
    if (this._checkpointed);
      return;
    this._versionCheckpoint = this._version;
    this._checkpointed = true;
    this._listenersCheckpoint = new Map(this._listeners.entries().map(([kind, listenerVersions]) => {
      return [kind, new Map(listenerVersions.entries())];
    }));
  }
  revert() {
    if (!this._checkpointed)
      return;
    this._version = this._versionCheckpoint;
    this._versionCheckpoint = null;
    this._listeners = this._listenersCheckpoint;
    this._listenersCheckpoint = null;
    this._checkpointed = false;
  }
}

class View extends ViewBase {
  constructor(type, scope) {
    super(type, scope);
    this._items = [];
    this._itemsCheckpoint = null;
  }
  get(id) {
    for (let entry of this._items) {
      if (JSON.stringify(entry.id) == JSON.stringify(id)) {
        return this._restore(entry);
      }
    }
  }
  query() {
    // TODO
  }
  // HACK: replace this with some kind of iterator thing?
  toList() {
    return this._items.map(entry => this._restore(entry));
  }
  // thing()

  store(entity) {
    this._items.push(this._serialize(entity));
    this._mutate();
    this._fire('change');
  }
  remove(id) {
    // TODO
  }
  // TODO: Something about iterators??
  // TODO: Something about changing order?
  checkpoint() {
    super.checkpoint();
    this._itemsCheckpoint = this._items.concat();
  }
  revert() {
    super.revert();
    this._items = this._itemsCheckpoint;
    this._itemsCheckpoint = null;
  }
}

class Variable extends ViewBase {
  constructor(type, scope) {
    super(type, scope);
    this._stored = null;
    this._storedCheckpoint = null;
  }
  // HACK: this should be async
  get() {
    return this._restore(this._stored);
  }
  set(entity) {
    if (entity[identifier] == undefined)
      entity[identifier] = this._scope._newIdentifier(this, this._scope.typeFor(entity));
    this._stored = this._serialize(entity);
    this._mutate();
    this._fire('change');
  }
  on(kind, callback) {
    let trigger = kind == 'change';
    super.on(kind, callback, trigger);
  }
  checkpoint() {
    super.checkpoint();
    this._storedCheckpoint = this._stored;
  }
  revert() {
    super.revert();
    this._stored = this._storedCheckpoint;
    this._storedCheckpoint = null;
  }
}

Object.assign(module.exports, {
  View,
  Variable,
});
