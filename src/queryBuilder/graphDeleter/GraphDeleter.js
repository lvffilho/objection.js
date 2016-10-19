import _ from 'lodash';
import Promise from 'bluebird';
import deepdiff from 'deep-diff';
import uuid from 'node-uuid';
import Model from '../../model/Model'

export default class GraphDeleter {

  constructor(modelClass, id) {
      this.modelClass = modelClass;
      this.modelID = id;

      this.deletesRelation = [];
      this.deletesBase = [];

      this.queries = [];
  }

  generateQueries() {
      try {
          this.generateRelationQuery();
          this.generateBaseQuery();

          this.orderQueries();
      } catch (err) {
          console.log(err);
      }

      return this.queries;
  }

  generateBaseQuery() {
      let baseDelete = this.modelClass.query().deleteById(this.modelID);

      this.deletesBase.push(baseDelete);
  }

  generateRelationQuery() {
      let relationMappings = this.modelClass.relationMappings;

      for (let relationMapping in relationMappings) {
          let currentRelation = relationMappings[relationMapping];

          let relationModelClass = currentRelation.modelClass;
          let relationField = '' + currentRelation.relationField;
          let relationMode = currentRelation.relation;
          let relationType = currentRelation.type

          if (relationType !== 'reference') {
              let isManyToMany = (relationMode === Model.ManyToManyRelation);
              if (isManyToMany){
                  if (!currentRelation.join.through.modelClass) {
                      throw new Error('modelClass from ManyToManyRelation is required.');
                  }

                  let manyToManyModel = currentRelation.join.through.modelClass;
                  let fromField = '' + currentRelation.join.through.from.split('.')[1];

                  let deleteManyToManyQuery = manyToManyModel.query().delete().where(fromField, '=', this.modelID);
                  this.deletesRelation.push(deleteManyToManyQuery);
              }

              let deleteQuery = relationModelClass.query().delete().where(relationField, '=', this.modelID);
              this.deletesRelation.push(deleteQuery);
          }
      }
  }

  orderQueries() {
      for (let item in this.deletesRelation) {
          let query = this.deletesRelation[item];

          this.queries.push(query);
      }

      for (let item in this.deletesBase) {
          let query = this.deletesBase[item];

          this.queries.push(query);
      }
  }

}
