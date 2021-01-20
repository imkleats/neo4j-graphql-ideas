import { translate } from "./translate";
import {
  buildASTSchema,
  GraphQLObjectType,
  GraphQLSchema,
  parse,
  isObjectType,
  GraphQLField,
  getNamedType,
} from "graphql";
import { flow, join } from "lodash/fp";

const relatedField = {
  name: "Related Object - name",
  value: 100,
};

const mockTest = {
  someField: "Test Object - someField",
  relatedField,
};

const sdl = `
  type Test {
    someField: String
    relatedField: Related @relationship(name: "RELATED" direction: "OUT")
  }
  
  type Related {
    name: String
    value: Int
  }
  
  type Query {
    testRelation: Test
  }
  
  directive @relationship(name: String!, direction: String!) on FIELD_DEFINITION
  `;

const schema = buildASTSchema(parse(sdl));
const queryType = schema.getType("Query");
const queryDefinitionFields = isObjectType(queryType) && queryType.getFields();
queryDefinitionFields.testRelation["resolve"] = function (
  obj,
  params,
  ctx,
  resolveInfo
) {
  const returnType = getNamedType(resolveInfo.returnType);
  console.log(resolveInfo.fieldNodes);
  if (isObjectType(returnType))
    console.log(returnType.extensions?.resolveToCypherAst());
  return mockTest;
};

const addMatchClause = (name: string) => (alias: string) => (
  relationship: string
) => (sb: string) => sb + `MATCH ${relationship}(${alias}:${name})`;
const addSubqueries = (subqueries: string) => (sb: string) =>
  subqueries ? sb + "\n" + subqueries : sb;
const addReturnClause = (item: string) => (returnList: string) => (
  alias: string
) => (sb: string) =>
  sb + "\n" + `RETURN ${item} { ${returnList} }${alias ? ` AS ${alias}` : ""}`;

// I think there are a couple different approaches. If you think of
// anything else better, I'm just experimenting without direction.
const selectionReducer = (acc, [fieldKey, subquery]) => {
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

const applyFieldCypherAstResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
): Function => {
  const fieldType = getNamedType(field.type);
  const safeType = fieldType.name[0].toLowerCase() + fieldType.name.slice(1);
  // parentType is Query
  if (parentType === schema.getQueryType()) {
    // need to branch between ObjectType & LeafType
    return function (parent, params, ctx, resolveInfo) {
      return [
        resolveInfo.fieldNodes[0],
        function (selections: any[]) {
          const { subqueries, returnList } = selections.reduce(
            selectionReducer,
            { subqueries: [], returnList: [] }
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
        },
      ];
    };
  }
  // parentType is Mutation
  if (parentType === schema.getMutationType()) {
  }
  if (isObjectType(fieldType)) {
    // need to branch between ObjectType & LeafType

    // refactor Relationships to its own function
    const relationshipDirective = field?.astNode?.directives?.find(
      (directive) => directive.name.value === "relationship"
    );
    const relationshipName = relationshipDirective?.arguments.find(
      (argNode) => argNode.name.value === "name"
    )?.value;
    const relationshipDirection = relationshipDirective?.arguments.find(
      (argNode) => argNode.name.value === "direction"
    )?.value;
    const relName =
      relationshipName?.kind === "StringValue" && relationshipName.value;
    const relDir =
      relationshipDirection?.kind === "StringValue" &&
      relationshipDirection.value;
    const relationship = (parentAlias) =>
      `(${parentAlias})${relDir == "IN" ? "<-" : "-"}[:${relName}]${
        relDir == "OUT" ? "->" : "-"
      }`;

    return function (parent, params, ctx, resolveInfo) {
      return [
        resolveInfo.fieldNodes[0],
        function (selections: any[]) {
          const { subqueries, returnList } = selections.reduce(
            selectionReducer,
            { subqueries: [], returnList: [] }
          );
          return {
            Kind: "SUBQUERY",
            parent,
            value: flow(
              (sb) => sb + "CALL {\n",
              (sb) => sb + `WITH ${parent?.alias ?? parent?.name?.value}\n`,
              addMatchClause(field.name)(safeType)(
                relationship(parent?.alias ?? parent?.name?.value)
              ),
              addSubqueries(join("\n")(subqueries)),
              addReturnClause(safeType)(join(", ")(returnList))(field.name),
              (sb) => sb + "\n}"
            )(""),
            returnList: `${field.name}: ${field.name}`,
            selections,
          };
        },
      ];
    };
  }
  return function (parent, params, ctx, resolveInfo) {
    return [
      resolveInfo.fieldNodes[0],
      function (_selections: any[]) {
        return {
          Kind: "ATTRIBUTE",
          returnList: `.${field.name}`,
        };
      },
    ];
  };
};

const applyObjectCypherAstResolver = (
  schema: GraphQLSchema,
  namedType: GraphQLObjectType,
  typeConfig: any
): void => {
  // Arguments do not need to necessarily mirror resolve function arguments
  // but it's a nice analog.
  // However, the function signature should be intentional and standardized into its
  // own Typescript type, and it should return some kind of output that could easily
  // be modifiable to support a middleware chain that allows for easy creation of
  // either schema or query directives. Think graphql-tools resolver composition
  // pre-transpilation. Then "features" like Filter argument support or whatever
  // are actually separable as their own internally applied middleware.
  const safeType = namedType.name.toLowerCase();
  const fieldDefs = Object.values(namedType.getFields());

  fieldDefs.forEach((field) => {
    field.resolve = function (parent, params, ctx, resolveInfo) {
      console.log(resolveInfo.fieldNodes);
      return parent[resolveInfo.fieldName];
    };
    field.extensions = {
      ...field.extensions,
      resolveToCypherAst: applyFieldCypherAstResolver(schema, namedType, field),
    };
  });
};

const applyNeo4jExtensions = (
  schema: GraphQLSchema,
  userConfig: { [key: string]: any }
) => {
  const typeMap = schema.getTypeMap();
  Object.values(typeMap)
    .filter((namedType) => isObjectType(namedType))
    .forEach((namedType: GraphQLObjectType, idx, src) => {
      // The resolveToCypher function is just one example of possible field on extensions.
      // It might make sense to have other utility fields or auxilliary functions that will not change
      // after schema construction. Whether these are stored on the extensions object or curried onto
      // resolveToCypherAst* is an open choice.
      applyObjectCypherAstResolver(
        schema,
        namedType,
        userConfig[namedType.name]
      );
    });
};

applyNeo4jExtensions(schema, {});
const query = `
  query { 
      testRelation { 
          someField
          relatedField { 
              name
              value 
          }
      }
  }`;

const cypher = translate({
  schema,
  document: parse(query),
});
// @ts-ignore
console.log(JSON.stringify(cypher!.data, null, 2));
// @ts-ignore
console.log(cypher.data.testRelation.queryString);
