import _ from 'lodash';
import Promise from 'bluebird';
import clone from 'lodash/clone';
import omit from 'lodash/omit';
import DelegateOperation from './DelegateOperation';
import {isPostgres} from '../../utils/dbUtils';
import GraphUpdater from '../GraphUpdater/GraphUpdater'

export default class UpdateGraphOperation extends DelegateOperation {

  constructor(name, opt) {
    super(name, opt);

    // Our delegate method inherits from `UpdateRelation`. Disable the call-time
    // validation. We do the validation in onAfterQuery instead.
    this.model = null;
    this.databaseModel = null;
    this.modelOptions = clone(this.opt.modelOptions) || {};
    this.isWriteOperation = true;

    this.delegate.modelOptions.skipValidation = true;
  }

  call(builder, args) {
    const retVal = super.call(builder, args);

    // We resolve this query here and will not execute it. This is because the root
    // value may depend on other models in the graph and cannot be inserted first.
    builder.resolve([]);

    this.model = builder.modelClass().ensureModel(args[0], this.modelOptions);

    return retVal;
  }

  get models() {
    return this.delegate.models;
  }

  get isArray() {
    return this.delegate.isArray;
  }

  onBefore() {
    // Do nothing.
  }

  onBeforeInternal() {
    // Do nothing. We override this with empty implementation so that
    // the $beforeInsert() hooks are not called twice for the root models.
  }

  onBeforeBuild() {
    // Do nothing.
  }

  onBuild() {
    // Do nothing.
  }

  // We overrode all other hooks but this one and do all the work in here.
  // This is a bit hacky.
  onAfterQuery(builder) {
      const ModelClass = builder.modelClass();
      const object = this.model;
      const currentID = object.id;

      let query = ModelClass.query();
      let eagers = ModelClass.eagers;

      if (typeof(eagers) !== 'undefined' && eagers !== null) {
          query.eager(eagers);
      }

      query.findById(currentID).then(function(dbObject) {
          let updater = new GraphUpdater(ModelClass, dbObject, object);
          let queries = updater.generateQueries();

          Promise.all(queries);
      }).catch(function(err) {
          console.log('UpdateGraphOperation ' + err);
      });
  }

  onAfterInternal() {
    // We override this with empty implementation so that the $afterInsert() hooks
    // are not called twice for the root models.
    return true;
  }

}
