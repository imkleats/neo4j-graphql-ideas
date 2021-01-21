import {
  getNamedType,
  GraphQLAbstractType,
  GraphQLField,
  GraphQLObjectType,
  GraphQLSchema,
} from "graphql";
import { flow, join, map } from "lodash/fp";
import {
  addMatchClause,
  addSubqueries,
  addReturnClause,
  buildRelationship,
} from "./QueryBuilder";

export const QueryObjectTypeMetadataResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => (parent, params, ctx, resolveInfo) => resolveInfo.fieldNodes[0];

export const QueryObjectTypeResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => {
  const fieldType = getNamedType(field.type);
  const safeType = fieldType.name[0].toLowerCase() + fieldType.name.slice(1);

  return function ({ parent, children: selections }, params, ctx, resolveInfo) {
    const { subqueries, returnList } = Object.entries(selections).reduce(
      selectionReducer,
      {
        subqueries: [],
        returnList: [],
      }
    );
    return {
      Kind: "QUERY",
      queryString: flow(
        addMatchClause(fieldType.name)(field.name)(""),
        addSubqueries(join("\n")(subqueries)),
        addReturnClause(safeType)(join(", ")(returnList))(field.name)
      )(""),
      selections,
      subqueries,
      returnList,
    };
  };
};

export const AbstractTypeMetadataResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => (parent, params, ctx, resolveInfo) => resolveInfo.fieldNodes[0];

export const AbstractTypeResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => {
  const fieldType = getNamedType(field.type);
  const possibleTypes = schema
    .getPossibleTypes(fieldType as GraphQLAbstractType)
    .map((node) => node.name);

  return function ({ parent, children: selections }, params, ctx, resolveInfo) {
    const parentAlias = parent?.alias ?? parent?.name?.value;
    const unions = possibleTypes.map((possibleType) => {
      const { subqueries, returnList } = Object.entries(
        selections[possibleType]
      ).reduce(selectionReducer, {
        subqueries: [],
        returnList: [],
      });
      return { unionType: possibleType, subqueries, returnList };
    });
    return {
      Kind: "SUBQUERY",
      parent,
      value: flow(
        (sb) => sb + "CALL {\n",
        (sb) =>
          sb +
          join("\nUnion\n")(
            map((union) =>
              flow(
                (sb) => sb + `WITH ${parentAlias}\n`,
                addMatchClause(union.unionType)(field.name)(
                  buildRelationship(schema, parentAlias, field)
                ),
                addSubqueries(join("\n")(union.subqueries)),
                addReturnClause(field.name)(join(", ")(union.returnList))(
                  field.name
                )
              )("")
            )(unions)
          ),
        (sb) => sb + "\n}"
      )(""),
      returnList: `${field.name}: ${field.name}`,
      selections,
    };
  };
};

export const QueryAbstractTypeResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => {
  const fieldType = getNamedType(field.type);
  const possibleTypes = schema
    .getPossibleTypes(fieldType as GraphQLAbstractType)
    .map((node) => node.name);

  return function ({ parent, children: selections }, params, ctx, resolveInfo) {
    const unions = possibleTypes.map((possibleType) => {
      const { subqueries, returnList } = Object.entries(
        selections[possibleType]
      ).reduce(selectionReducer, {
        subqueries: [],
        returnList: [],
      });
      return { unionType: possibleType, subqueries, returnList };
    });
    const returnList = unions.reduce(
      (acc, union) => acc.concat(union.returnList),
      []
    );
    return {
      Kind: "QUERY",
      parent,
      queryString: flow(
        (sb) => sb + "CALL {\n",
        (sb) =>
          sb +
          join("\nUNION\n")(
            map((union) =>
              flow(
                addMatchClause(union.unionType)(field.name)(""),
                addSubqueries(join("\n")(union.subqueries)),
                addReturnClause(field.name)(join(", ")(union.returnList))(
                  field.name
                )
              )("")
            )(unions)
          ),
        (sb) => sb + "\n}",
        addReturnClause(field.name)(join(", ")(returnList))(field.name)
      )(""),
      returnList: `${field.name}: ${field.name}`,
      selections,
    };
  };
};

export const ObjectTypeMetadataResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => (parent, params, ctx, resolveInfo) => resolveInfo.fieldNodes[0];

export const ObjectTypeResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => {
  const fieldType = getNamedType(field.type);
  const safeType = fieldType.name[0].toLowerCase() + fieldType.name.slice(1);

  return function ({ parent, children: selections }, params, ctx, resolveInfo) {
    const parentAlias = parent.alias ?? parent.name.value;
    const { subqueries, returnList } = Object.entries(selections).reduce(
      selectionReducer,
      {
        subqueries: [],
        returnList: [],
      }
    );
    return {
      Kind: "SUBQUERY",
      parent,
      value: flow(
        (sb) => sb + "CALL {\n",
        (sb) => sb + `WITH ${parentAlias}\n`,
        addMatchClause(fieldType.name)(field.name)(
          buildRelationship(schema, parentAlias, field)
        ),
        addSubqueries(join("\n")(subqueries)),
        addReturnClause(safeType)(join(", ")(returnList))(field.name),
        (sb) => sb + "\n}"
      )(""),
      returnList: `${field.name}: ${field.name}`,
      selections,
    };
  };
};

export const LeafTypeMetadataResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) => (parent, params, ctx, resolveInfo) => resolveInfo.fieldNodes[0];

export const LeafTypeResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
) =>
  function (parent, params, ctx, resolveInfo) {
    return {
      Kind: "ATTRIBUTE",
      returnList: `.${field.name}`,
    };
  };

const selectionReducer = (acc, [fieldKey, { astNode: subquery }]) => {
  switch (subquery?.Kind) {
    case "SUBQUERY":
      acc.subqueries = acc.subqueries.concat(subquery.value);
      acc.returnList = acc.returnList.concat(subquery.returnList);
      break;
    case "ATTRIBUTE":
      acc.returnList = acc.returnList.concat(subquery.returnList);
      break;
    default:
      break;
  }
  return acc;
};
