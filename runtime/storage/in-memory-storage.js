// @
// Copyright (c) 2017 Google Inc. All rights reserved.
// This code may only be used under the BSD style license found at
// http://polymer.github.io/LICENSE.txt
// Code distributed by Google as part of this project is also
// subject to an additional IP rights grant found at
// http://polymer.github.io/PATENTS.txt
'use strict';

import {assert} from '../../platform/assert-web.js';
import {Tracing} from '../../tracelib/trace.js';
import {StorageProviderBase} from './storage-provider-base.js';
import {KeyBase} from './key-base.js';
import {CrdtCollectionModel} from './crdt-collection-model.js';

class InMemoryKey extends KeyBase {
  constructor(key) {
    super();
    let parts = key.split('://');
    this.protocol = parts[0];
    assert(this.protocol == 'in-memory');
    parts = parts[1] ? parts.slice(1).join('://').split('^^') : [];
    this.arcId = parts[0];
    this.location = parts[1];
    assert(this.toString() == key);
  }

  childKeyForHandle(id) {
    return new InMemoryKey('in-memory://');
  }

  toString() {
    if (this.location !== undefined && this.arcId !== undefined)
      return `${this.protocol}://${this.arcId}^^${this.location}`;
    if (this.arcId !== undefined)
      return `${this.protocol}://${this.arcId}`;
    return `${this.protocol}`;
  }
}

let __storageCache = {};

export class InMemoryStorage {
  constructor(arcId) {
      assert(arcId !== undefined, 'Arcs with storage must have ids');
      this._arcId = arcId;
      this._memoryMap = {};
      this.localIDBase = 0;
      // TODO(shans): re-add this assert once we have a runtime object to put it on.
      // assert(__storageCache[this._arc.id] == undefined, `${this._arc.id} already exists in local storage cache`);
      __storageCache[this._arcId] = this;
  }

  async construct(id, type, keyFragment) {
    let key = new InMemoryKey(keyFragment);
    if (key.arcId == undefined)
      key.arcId = this._arcId;
    if (key.location == undefined)
      key.location = 'in-memory-' + this.localIDBase++;
    let provider = InMemoryStorageProvider.newProvider(type, this._arcId, undefined, id, key.toString());
    if (this._memoryMap[key.toString()] !== undefined)
      return null;
    this._memoryMap[key.toString()] = provider;
    return provider;
  }

  async connect(id, type, keyString) {
    let key = new InMemoryKey(keyString);
    if (key.arcId !== this._arcId.toString()) {
      if (__storageCache[key.arcId] == undefined)
        return null;
      return __storageCache[key.arcId].connect(id, type, keyString);
    }
    if (this._memoryMap[keyString] == undefined)
      return null;
    // TODO assert types match?
    return this._memoryMap[keyString];
  }

  parseStringAsKey(string) {
    return new InMemoryKey(string);
  }
}

class InMemoryStorageProvider extends StorageProviderBase {
  static newProvider(type, arcId, name, id, key) {
    if (type.isCollection)
      return new InMemoryCollection(type, arcId, name, id, key);
    return new InMemoryVariable(type, arcId, name, id, key);
  }
}

class InMemoryCollection extends InMemoryStorageProvider {
  constructor(type, arcId, name, id, key) {
    super(type, arcId, name, id, key);
    this._model = new CrdtCollectionModel();
    assert(this._version !== null);
  }

  clone() {
    let handle = new InMemoryCollection(this._type, this._arcId, this.name, this.id);
    handle.cloneFrom(this);
    return handle;
  }

  async cloneFrom(handle) {
    let {list, version} = await handle.toListWithVersion();
    assert(version !== null);
    await this._fromListWithVersion(list, version);
  }

  async _fromListWithVersion(list, version) {
    this._version = version;
    this._model = new CrdtCollectionModel();
    for (let value of list) {
      this._model.add(value.id, value, [undefined]);
    }
  }

  traceInfo() {
    return {items: this._model.size};
  }
  // HACK: replace this with some kind of iterator thing?
  async toList() {
    return this._model.toList();
  }

  async toListWithVersion() {
    let list = this._model.toList();
    return {list, version: this._version};
  }

  // FIXME: reorder arguments to make originatorID optional and membershipKey required
  async store(value, originatorId=undefined, membershipKey=undefined) {
    let trace = Tracing.start({cat: 'handle', name: 'InMemoryCollection::store', args: {name: this.name}});
    let effective = this._model.add(value.id, value, [membershipKey]);
    this._version++;
    this._fire('change', {add: [{value, keys: [membershipKey], effective}], version: this._version, originatorId});
    trace.end({args: {value}});
  }

  async remove(id, originatorId=undefined, membershipKeys=undefined) {
    let trace = Tracing.start({cat: 'handle', name: 'InMemoryCollection::remove', args: {name: this.name}});
    if (!membershipKeys) {
      membershipKeys = this._model.getKeys(id);
    }
    let value = this._model.getValue(id);
    let effective = this._model.remove(id, membershipKeys);
    this._version++;
    this._fire('change', {remove: [{value, keys: membershipKeys, effective}], version: this._version, originatorId});
    trace.end({args: {entity: value}});
  }

  clearItemsForTesting() {
    this._model = new CrdtCollectionModel();
  }

  // TODO: Something about iterators??
  // TODO: Something about changing order?

  serializedData() {
    return this.toList();
  }
}

class InMemoryVariable extends InMemoryStorageProvider {
  constructor(type, arcId, name, id, key) {
    super(type, arcId, name, id, key);
    this._stored = null;
  }

  clone() {
    let variable = new InMemoryVariable(this._type, this._arcId, this.name, this.id);
    variable.cloneFrom(this);
    return variable;
  }

  async cloneFrom(handle) {
    let {data, version} = await handle.getWithVersion();
    await this._setWithVersion(data, version);
  }

  async _setWithVersion(data, version) {
    this._stored = data;
    this._version = version;
  }

  traceInfo() {
    return {stored: this._stored !== null};
  }

  async get() {
    return this._stored;
  }

  async getWithVersion() {
    return {data: this._stored, version: this._version};
  }

  async set(entity, originatorId, barrier) {
    // If there's a barrier set, then the originating storage-proxy is expecting
    // a result so we cannot suppress the event here.
    if (JSON.stringify(this._stored) == JSON.stringify(entity) && barrier == null)
      return;
    this._stored = entity;
    this._version++;
    this._fire('change', {data: this._stored, version: this._version, originatorId, barrier});
  }

  async clear(originatorId, barrier) {
    this.set(null, originatorId, barrier);
  }

  serializedData() {
    return [this._stored];
  }
}
