import _ from 'lodash';
import Promise from 'bluebird';
import deepdiff from 'deep-diff';

export default class GraphUpdater {

  constructor(modelClass, dbJson, updateJson) {
      this.modelClass = modelClass;
      this.model = updateJson;
      this.dbModel = dbJson;

      this.deletes = [];
      this.updates = [];
      this.inserts = [];

      this.queries = [];
  }

  generateQueries() {
      this.generateBaseQuery();

      this.generateForDiff();

      this.orderQueries();

      return this.queries;
  }

  generateBaseQuery() {
      let modelToUpdate = this.modelClass.ensureModel(this.model);
      let baseUpdate = this.modelClass.query().update(modelToUpdate).where('id', '=', this.model.id);

      this.queries.push(baseUpdate);
  }

  generateFromInsert(currentDiff) {
      let json = currentDiff.item.rhs;
      let path = currentDiff.path[0];

      let relation = this.modelClass.relationMappings[path];
      let relationModelClass = relation.modelClass;
      let modelToPersist = relationModelClass.ensureModel(json);

      // Add FK property in JSON
      if (!relation.relationField) {
          throw new Error('Relation Field is required for update cascade.');
      }

      let fk = relation.relationField;
      let fk_id = this.model.id;

      Object.defineProperty(modelToPersist, fk, {
          value: fk_id,
          writable: true,
          enumerable: true,
          configurable: true
      });

      let insert = relationModelClass.query().insert(modelToPersist);

      this.inserts.push(insert);
  }

  generateFromDelete(currentDiff) {
      let deletedID = currentDiff.lhs.id;
      let path = currentDiff.path[0];

      let relation = this.modelClass.relationMappings[path];
      let relationModelClass = relation.modelClass;

      let deleteQuery = relationModelClass.query().deleteById(deletedID);

      this.deletes.push(deleteQuery);
  }

  generateFromUpdate(currentDiff) {
      let path = currentDiff.path;
      if (path.length === 1) {
          // update single property - not used because baseUpdate is always generated
      } else {
          let relation = path[0];
          let index = path[1];
          let property = path[2];
          let value = currentDiff.rhs;

          let relationMapping = this.modelClass.relationMappings[relation];
          let relationModelClass = relationMapping.modelClass;

          let json = this.model[relation][index];
          let currentID = json.id;

          let modelToPersist = relationModelClass.ensureModel(json);

          let updateQuery = relationModelClass.query().update(modelToPersist).where('id', '=', modelToPersist.id);

          this.updates.push(updateQuery);
      }
  }

  generateForDiff() {
      let newObject = JSON.parse(JSON.stringify(this.model));
      let oldObject = JSON.parse(JSON.stringify(this.dbModel));

      let diff = deepdiff.diff(oldObject, newObject);

      for (let key in diff) {
          let currentDiff = diff[key];
          let kind = currentDiff.kind;

          if (kind === 'A') {
              this.generateFromInsert(currentDiff);
          } else if (kind === 'E') {
              // Delete
              if (currentDiff.rhs === null) {
                  this.generateFromDelete(currentDiff);
              // Update
              } else {
                  this.generateFromUpdate(currentDiff)
              }
          }
      }
  }

  orderQueries() {
      // First Insert to garanted PK
      for (let item in this.inserts) {
          let query = this.inserts[item];

          this.queries.push(query);
      }

      // Updates
      for (let item in this.updates) {
          let query = this.updates[item];

          this.queries.push(query);
      }

      // Deletes
      for (let item in this.deletes) {
          let query = this.deletes[item];

          this.queries.push(query);
      }
  }

}
