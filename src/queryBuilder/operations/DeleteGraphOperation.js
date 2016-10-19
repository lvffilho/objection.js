import _ from 'lodash';
import Promise from 'bluebird';
import clone from 'lodash/clone';
import omit from 'lodash/omit';
import DelegateOperation from './DelegateOperation';
import {isPostgres} from '../../utils/dbUtils';
import GraphDeleter from '../graphDeleter/GraphDeleter'

export default class DeleteGraphOperation extends DelegateOperation {

  constructor(name, opt) {
    super(name, opt);

    this.modelID = null;

    this.isWriteOperation = true;
  }

  call(builder, args) {
    const retVal = super.call(builder, args);

    // We resolve this query here and will not execute it. This is because the root
    // value may depend on other models in the graph and cannot be inserted first.
    builder.resolve([]);

    this.modelID = args[0];

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

      let deleter = new GraphDeleter(ModelClass, this.modelID);
      let queries = deleter.generateQueries();

      Promise.all(queries);
  }

  onAfterInternal() {
    // We override this with empty implementation so that the $afterInsert() hooks
    // are not called twice for the root models.
    return true;
  }

}
