import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLField,
  getNamedType,
  isObjectType,
} from "graphql";
import {
  QueryObjectTypeResolver,
  ObjectTypeResolver,
  LeafTypeResolver,
} from "./resolvers";

export const applyFieldCypherAstResolver = (
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  field: GraphQLField<any, any>
): Function => {
  const fieldType = getNamedType(field.type);
  const safeType = fieldType.name[0].toLowerCase() + fieldType.name.slice(1);
  // parentType is Query
  if (parentType === schema.getQueryType()) {
    // need to branch between ObjectType & LeafType
    return QueryObjectTypeResolver(schema, parentType, field);
  }
  // parentType is Mutation
  if (parentType === schema.getMutationType()) {
  }
  if (isObjectType(fieldType)) {
    // TODO: need to branch between ObjectType & LeafType
    return ObjectTypeResolver(schema, parentType, field);
  }
  return LeafTypeResolver(schema, parentType, field);
};

export const applyObjectCypherAstResolver = (
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

export const applyNeo4jExtensions = (
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
