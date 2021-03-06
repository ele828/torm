import { Model } from './SequelizeModel';
import { Result } from './Result';
import { SequelizeDriver } from './SequelizeDriver';
import { sequelizeModelPool } from './SequelizeModelPool';
import { Operator } from './Operator';

export class ClassNotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

export class ModelNotFoundError extends Error {
  constructor(modelName: string) {
    super(`Model '${modelName}' is not found, maybe it's not defined properly yet`);
  }
}

export class WrongMethodInvokedError extends Error {
  constructor(method: string, instead: string) {
    super(`The method '${method}' can not be invoked in this scenario, please use ${instead} method instead`);
  }
}

/**
 * Designed API for query operations
 *
 * @interface QueryApi
 */
export interface IQuery<E extends Model> {
  findAll(): Result<E>;
  find(): any;
  column(name: string, alias?: string): Query<E>;
  not(name: string): Query<E>;
  where(conditions: Object): Query<E>;
  count(name: string, alias?: string): Promise<number>;
  limit(num: number): Query<E>;
  offset(num: number): Query<E>;
  order(): Query<E>;
  raw(): Result<E>;
}

/**
 * Torm query interface
 *
 * @export
 * @class Query
 * @template E
 */
export class Query<E extends Model> implements IQuery<E> {

  /**
   * Sequelize entity reference
   *
   * @private
   * @type {E}
   */
  private _clazz: { prototype: E };
  private _attributes: Array<any>;
  private _whereConditions: Array<Object>;
  private _excludes: Array<any>;
  private _limit: number;
  private _offset: number;

  constructor(clazz: { prototype: E }) {
    this._clazz = clazz;
    this._attributes = [];
    this._whereConditions = [];
    this._excludes = [];
  }

  /**
   * Count number in specify conditions
   * [sequelize.fn('COUNT', sequelize.col('hats')), 'no_hats']
   * 
   * TODO: what if modelName is not found???
   *
   * @param {string} [name]
   * @param {string} [alias]
   * @returns {Promise<number>}
   */
  public async count(name?: string, alias?: string): Promise<number> {
    let sequelize = SequelizeDriver.sequelize;
    let modelName = this._clazz.prototype.constructor.name.toLowerCase();
    let model: any = sequelizeModelPool.poll(modelName);

    this._checkModelExist(model, modelName);
    let param = {attributes: []};

    // count *
    if (!name || name.trim() === '') {
      name = '*';
    }

    if (!alias || alias.trim() === '') {
      alias = '__alias__';
    }

    param.attributes.push([sequelize.fn('COUNT', sequelize.col(name)), alias]);

    let retval = await model.findAll(param);
    if (retval.length <= 0) return;

    return retval[0].dataValues[alias];
  }

  /**
   * Complex query conditions
   * TODO: complex where query implementations.
   *
   * @param {{}} conditions
   * @returns {Query<E>}
   */
  public where(conditions: Object): Query<E> {
    if (!conditions) return this;
    // Compatible for Operator query builder
    if (conditions instanceof Operator)
      conditions = (<any>conditions).expr;
    this._whereConditions.push(conditions);
    return this;
  }

  /**
   * Exclude specified columns
   *
   * @returns {Query<E>}
   */
  public not(name: string): Query<E> {
    if (!name) return this;

    this._excludes.push(name);
    return this;
  }

  /**
   * Specify query columns.
   * If invoked, findAll will just query this specified columns instead of query all.
   *
   * @param {string} name
   * @param {string} [alias]
   * @returns {Query<E>}
   */
  public column(name: string, alias?: string): Query<E> {
    if (!name) return this;

    if (!alias)
      this._attributes.push(name);
    else {
      this._attributes.push([name, alias]);
    }
    return this;
  }

  /**
   * Build part conditions, execute and find them.
   * If we invoke column(), where(), not(),
   * we can just use find() to execute
   *
   * @returns {*}
   */
  public find(): any {
    if (!this._clazz)
      throw new ClassNotFoundError('Lack of class property, please pass it in query clause');

    // if column(), not() is invoked, we can just invoke find() to execute query
    if (this._attributes.length <= 0 && this._excludes.length <= 0)
      throw new WrongMethodInvokedError('find()', 'findAll()');

    let modelName = this._clazz.prototype.constructor.name.toLowerCase();
    let model: any = sequelizeModelPool.poll(modelName);
    this._checkModelExist(model, modelName);

    return <any>model.findAll(this._buildComplexQuery());
  }

  /**
   * Build all conditions, and executes findAll operation
   * if column(), not() is invoked, we can just use find() method.
   * @returns {Result<E>}
   */
  public findAll(): Result<E> {
    if (!this._clazz)
      throw new ClassNotFoundError('Lack of class property, please pass it in query clause');

    // if column(), not() is invoked, we can just invoke find() to execute query
    if (this._attributes.length > 0 || this._excludes.length > 0)
      throw new WrongMethodInvokedError('findAll()', 'find()');

    // get sequelize model from model pool
    let modelName = this._clazz.prototype.constructor.name.toLowerCase();
    let model: any = sequelizeModelPool.poll(modelName);
    this._checkModelExist(model, modelName);

    return <Result<E>>model.findAll(this._buildQuery());
  }

  /**
   * Basic query composition
   *
   * @private
   * @returns {Object}
   */
  private _buildQuery(): Object {
    let params = {};
    if (this._limit) {
      params['limit'] = this._limit;
    }
    if (this._offset) {
      params['offset'] = this._offset;
    }

    // build where query
    this._buildWhere(params);

    return params;
  }

  /**
   * Build comlex query param into one object
   *
   * @private
   * @returns {Object}
   */
  private _buildComplexQuery(): Object {
    let params;
    params = { };

    // build attributes
    if (this._attributes.length > 0) {
      params.attributes = [];
      this._attributes.forEach(attr => {
        params.attributes.push(attr);
      });
    }

    // build excludes query
    if (this._excludes.length > 0) {
      delete params.attributes;
      params.attributes = {};
      params.attributes['exclude'] = [];
      this._excludes.forEach(ex => {
        params.attributes['exclude'].push(ex);
      });
    }

    if (this._limit || this._offset) {
      if (this._attributes.length === 0)
        // avoid query bug of sequelize
        if (Array.isArray(params.attributes))
          delete params.attributes;
    }

    if (this._limit) {
      params['limit'] = this._limit;
    }

    if (this._offset) {
      params['offset'] = this._offset;
    }

    // build where query
    this._buildWhere(params);

    return params;
  }

  /**
   * Build where conditions
   *
   * @private
   * @param {Object} param
   */
  private _buildWhere(param: Object): void {
    if (this._whereConditions.length > 0) {
      let conditions = {};
      this._whereConditions.forEach(cond => {
        Object.keys(cond).forEach(key => {
          conditions[key] = cond[key];
        });
      });
      param['where'] = conditions;
    }
  }

  /**
   * Assure model can be found in model pool
   * 
   * @private
   * @param {any} model
   * @param {any} name
   */
  private _checkModelExist(model, name) {
    if (!model) {
      throw new ModelNotFoundError(name);
    }
  }

  /**
   * Limit record number of each query
   *
   * @param {number} num
   * @returns {Query<E>}
   */
  public limit(num: number): Query<E> {
    if (num) this._limit = num;
    return this;
  }

  /**
   * Skip record number
   *
   * @param {number} num
   * @returns {Query<E>}
   */
  public offset(num: number): Query<E> {
    if (num) this._offset = num;
    return this;
  }

  // TODO: order function implementation
  public order(): Query<E> {
    throw 'Not Implemented';
  }

  // TODO: raw sql query
  public raw(): Result<E> {
    throw 'xxx';
  }

}
