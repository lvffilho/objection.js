import _ from 'lodash';
import Promise from 'bluebird';
import deepdiff from 'deep-diff';
import uuid from 'node-uuid';
import Model from '../../model/Model'

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

      let relationMapping = this.modelClass.relationMappings[path];
      let relationModelClass = relationMapping.modelClass;
      let modelToPersist = relationModelClass.ensureModel(json);

      // Add FK property in JSON
      if (!relationMapping.relationField) {
          throw new Error('Relation Field is required for update cascade.');
      }

      let fk = relationMapping.relationField;
      let fk_id = this.model.id;

      Object.defineProperty(modelToPersist, fk, {
          value: fk_id,
          writable: true,
          enumerable: true,
          configurable: true
      });

      // Gerantee ID
      if (!modelToPersist.id) {
          modelToPersist.id = uuid.v4();
      }

      let insert = relationModelClass.query().insert(modelToPersist);
      this.inserts.push(insert);

      let isManyToMany = (relationMapping.relation == Model.ManyToManyRelation);
      if (isManyToMany){
          if (!relationMapping.join.through.modelClass) {
              throw new Error('modelClass from ManyToManyRelation is required.');
          }

          let manyToManyModel = relationMapping.join.through.modelClass;
          let fromField = relationMapping.join.through.from.split('.')[1];
          let toField = relationMapping.join.through.to.split('.')[1];

          let jsonManyToMany = {};
          jsonManyToMany[fromField] = this.model.id;
          jsonManyToMany[toField] = modelToPersist.id;

          let manyToManyToInsert = manyToManyModel.ensureModel(jsonManyToMany);

          let insertMany = manyToManyModel.query().insert(manyToManyToInsert);
          this.inserts.push(insertMany);
      }
  }

  generateFromDelete(currentDiff) {
      let deletedID = currentDiff.lhs.id;
      let path = currentDiff.path[0];

      let relationMapping = this.modelClass.relationMappings[path];
      let relationModelClass = relationMapping.modelClass;

      let isManyToMany = (relationMapping.relation == Model.ManyToManyRelation);
      if (isManyToMany){
          if (!relationMapping.join.through.modelClass) {
              throw new Error('modelClass from ManyToManyRelation is required.');
          }

          let manyToManyModel = relationMapping.join.through.modelClass;
          let toField = relationMapping.join.through.to.split('.')[1];

          let deleteManyToManyQuery = manyToManyModel.query().delete().where(toField, '=', deletedID);
          this.deletes.push(deleteManyToManyQuery);
      }

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
          let oldValue = currentDiff.lhs;
          let value = currentDiff.rhs;

          let relationMapping = this.modelClass.relationMappings[relation];
          let relationModelClass = relationMapping.modelClass;

          let isManyToMany = (relationMapping.relation == Model.ManyToManyRelation);
          if (isManyToMany) {

              let manyToManyModel = relationMapping.join.through.modelClass;
              if (!manyToManyModel) {
                  throw new Error('ModelClass from ManyToManyRelation is required.');
              }

              if (property === 'id') {
                  let fromField = relationMapping.join.through.from.split('.')[1];
                  let toField = relationMapping.join.through.to.split('.')[1];

                  let json = {};
                  json[toField] = value;
                  json[fromField] = this.model.id;

                  let modelToPersist = manyToManyModel.ensureModel(json);

                  let updateQuery = manyToManyModel.query().update(modelToPersist)
                      .where(toField, '=', oldValue)
                      .where(fromField, '=', this.model.id);

                  this.updates.push(updateQuery);
              }
          } else {
              let json = this.model[relation][index];
              let currentID = json.id;

              let modelToPersist = relationModelClass.ensureModel(json);

              let updateQuery = relationModelClass.query().update(modelToPersist).where('id', '=', modelToPersist.id);

              this.updates.push(updateQuery);
          }
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
