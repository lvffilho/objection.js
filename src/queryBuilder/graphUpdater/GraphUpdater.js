import _ from 'lodash';
import Promise from 'bluebird';
import uuid from 'node-uuid';
import Model from '../../model/Model'
import SortedMap from "collections/sorted-map";

export default class GraphUpdater {

    constructor(modelClass, dbJson, updateJson) {
        this.modelClass = modelClass;
        this.relationMappings = this.modelClass.relationMappings;

        this.model = updateJson;

        this.dbModel = dbJson;
        this.dbModelJson = this.clone(this.dbModel);

        this.deletes = [];
        this.updates = [];
        this.inserts = [];

        this.queries = [];

        this.mapOfOldIDs = new SortedMap();
        this.mapOfNewIDs = new SortedMap();
    }

    clone(source) {
        if (Object.prototype.toString.call(source) === '[object Array]') {
            var clone = [];
            for (var i = 0; i < source.length; i++) {
                clone[i] = this.clone(source[i]);
            }
            return clone;
        } else if (typeof(source) == "object") {
            var clone = {};
            for (var prop in source) {
                if (source.hasOwnProperty(prop)) {
                    clone[prop] = this.clone(source[prop]);
                }
            }
            return clone;
        } else {
            return source;
        }
    }

    generateQueries() {
        this.generateBaseQuery();

        this.populateIDSFromOlder();

        this.generateFromDifference();

        this.orderQueries();

        return this.queries;
    }

    generateBaseQuery() {
        let modelToUpdate = this.modelClass.ensureModel(this.model);
        let baseUpdate = this.modelClass.query().update(this.model).where('id', '=', this.model.id);

        this.queries.push(baseUpdate);
    }

    populateIDSFromOlder() {
        let self = this;
        _.each(this.relationMappings, (relationMapping, relationName) => {
            self.populateIDSFromRelationName(relationMapping, relationName);
        });
    }

    populateIDSFromRelationName(relationMapping, relationName) {
        let oldNodes = this.dbModelJson[relationName];
        let newNodes = this.model[relationName];

        let oldIDs = [];
        let newIDs = [];

        _.each(oldNodes, (value, index) => {
            if (value !== null && typeof(value) !== 'undefined') {
                oldIDs.push(value.id);
            }
        });
        this.mapOfOldIDs.set(relationName, oldIDs);

        _.each(newNodes, (value, index) => {
            if (value !== null && typeof(value) !== 'undefined') {
                newIDs.push(value.id);
            }
        });
        this.mapOfNewIDs.set(relationName, newIDs);
    }

    generateFromDifference() {
        let self = this;

        _.each(this.relationMappings, (relationMapping, relationName) => {
            self.generateDeleteFromIDs(relationName);
            self.generateInsertAndUpdateFromIDs(relationName);
        });
    }

    generateDeleteFromIDs(relationName) {
        let self = this;

        let currentOldIDs = this.mapOfOldIDs.get(relationName);
        let currentNewIDs = this.mapOfNewIDs.get(relationName);

        _.each(currentOldIDs, (currentID) => {
            if (currentNewIDs.indexOf(currentID) < 0) {
                self.generateDeleteFromID(relationName, currentID)
            }
        });
    }

    generateDeleteFromID(relationName, currentID) {
        let deletedID = currentID;

        let relationMapping = this.relationMappings[relationName];
        let relationModelClass = relationMapping.modelClass;

        let isManyToMany = (relationMapping.relation == Model.ManyToManyRelation);
        // ManyToMany Delete
        if (isManyToMany) {
            let manyToManyModel = relationMapping.join.through.modelClass;
            if (!manyToManyModel) {
                throw new Error('modelClass from ManyToManyRelation is required.');
            }

            let fromField = relationMapping.join.through.from.split('.')[1];
            let toField = relationMapping.join.through.to.split('.')[1];

            let deleteQuery = manyToManyModel.query().delete()
                .where(toField, '=', deletedID)
                .where(fromField, '=', this.model.id);

            this.deletes.push(deleteQuery);
            // Normal Delete
        } else {
            let deleteQuery = relationModelClass.query().deleteById(deletedID);

            this.deletes.push(deleteQuery);
        }
    }

    generateInsertAndUpdateFromIDs(relationName) {
        let self = this;

        let currentOldIDs = this.mapOfOldIDs.get(relationName);
        let currentNewIDs = this.mapOfNewIDs.get(relationName);

        _.each(currentNewIDs, (currentID) => {
            if (currentOldIDs.indexOf(currentID) < 0) {
                self.generateInsertFromID(relationName, currentID);
            } else {
                self.generateUpdateFromID(relationName, currentID);
            }
        });
    }

    getNewNodeFromRelationNameAndID(relationName, currentID) {
        let currentNode = null;
        let nodes = this.model[relationName];
        _.each(nodes, (current) => {
            if (current !== null && typeof(current) !== 'undefined') {
                if (current.id === currentID) {
                    currentNode = current;
                }
            }
        });
        return currentNode;
    }

    getOldNodeFromRelationNameAndID(relationName, currentID) {
        let currentNode = null;
        let nodes = this.dbModelJson[relationName];
        _.each(nodes, (current) => {
            if (current !== null && typeof(current) !== 'undefined') {
                if (current.id === currentID) {
                    currentNode = current;
                }
            }
        });
        return currentNode;
    }

    generateInsertFromID(relationName, currentID) {
        let json = this.getNewNodeFromRelationNameAndID(relationName, currentID);

        let relationMapping = this.relationMappings[relationName];
        let relationModelClass = relationMapping.modelClass;

        let isManyToMany = (relationMapping.relation == Model.ManyToManyRelation);
        if (isManyToMany) {
            if (!relationMapping.join.through.modelClass) {
                throw new Error('modelClass from ManyToManyRelation is required.');
            }

            // If reference just creates ManyToMany relation, else insert relation and manytomany
            if (relationMapping.type !== 'reference') {
                // Gerantee ID
                if (!json.id) {
                    json.id = uuid.v4();
                }

                let modelToPersist = relationModelClass.ensureModel(json);

                let insert = relationModelClass.query().insert(modelToPersist);
                this.inserts.push(insert);
            }

            let manyToManyModel = relationMapping.join.through.modelClass;
            let fromField = relationMapping.join.through.from.split('.')[1];
            let toField = relationMapping.join.through.to.split('.')[1];

            let jsonManyToMany = {};
            jsonManyToMany[fromField] = this.model.id;
            jsonManyToMany[toField] = currentID;

            let manyToManyToInsert = manyToManyModel.ensureModel(jsonManyToMany);

            let insertMany = manyToManyModel.query().insert(manyToManyToInsert);

            this.inserts.push(insertMany);
        } else {
            // Add FK property in JSON
            if (!relationMapping.relationField) {
                throw new Error('Relation Field is required for update cascade. Model: ' + relationModelClass.name);
            }

            let fk = relationMapping.relationField;
            let fk_id = this.model.id;

            Object.defineProperty(json, fk, {
                value: fk_id,
                writable: true,
                enumerable: true,
                configurable: true
            });

            // Gerantee ID
            if (!json.id) {
                json.id = uuid.v4();
            }

            let modelToPersist = relationModelClass.ensureModel(json);

            let insert = relationModelClass.query().insert(modelToPersist);
            this.inserts.push(insert);
        }
    }

    generateUpdateFromID(relationName, currentID) {
        let newValue = this.getNewNodeFromRelationNameAndID(relationName, currentID);

        let relationMapping = this.relationMappings[relationName];
        let relationModelClass = relationMapping.modelClass;

        let modelToPersist = relationModelClass.ensureModel(newValue);

        let updateQuery = relationModelClass.query().update(modelToPersist).where('id', '=', modelToPersist.id);

        this.updates.push(updateQuery);
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
