import {
  getFieldDef,
  buildResolveInfo,
  collectFields,
  defaultTypeResolver,
  ExecutionArgs,
  ExecutionResult,
} from "graphql/execution/execute";
import { getArgumentValues, getVariableValues } from "graphql/execution/values";
import { PromiseOrValue } from "graphql/jsutils/PromiseOrValue";
import { addPath, Path, pathToArray } from "graphql/jsutils/Path";
import { memoize3, isObjectLike, devAssert, inspect } from "./utils/jsutils";
import { getOperationRootType } from "graphql/utilities/";
import {
  GraphQLObjectType,
  FieldNode,
  GraphQLResolveInfo,
  GraphQLOutputType,
  locatedError,
  GraphQLError,
  isNonNullType,
  isAbstractType,
  isObjectType,
  isNamedType,
  GraphQLAbstractType,
  GraphQLFieldResolver,
  OperationDefinitionNode,
  FragmentDefinitionNode,
  GraphQLSchema,
  GraphQLLeafType,
  GraphQLTypeResolver,
  DocumentNode,
  Kind,
  assertValidSchema,
} from "graphql";

const defaultMetadataResolver = (parent, params, ctx, resolveInfo) =>
  resolveInfo.fieldNodes[0];
const defaultFieldResolver = ({ children }, params, ctx, resolveInfo) =>
  children;

type ObjMap<T> = { [key: string]: T };

interface ExecutionContext {
  schema: GraphQLSchema;
  fragments: { [key: string]: FragmentDefinitionNode };
  rootValue: any;
  contextValue: any;
  operation: OperationDefinitionNode;
  variableValues: { [key: string]: any };
  fieldResolver: GraphQLFieldResolver<any, any>;
  typeResolver: GraphQLTypeResolver<any, any>;
  errors: GraphQLError[];
}

export function translate(
  args: ExecutionArgs
): PromiseOrValue<ExecutionResult> {
  const {
    schema,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName,
    fieldResolver,
    typeResolver,
  } = args;

  // If arguments are missing or incorrect, throw an error.
  assertValidExecutionArguments(schema, document, variableValues);

  // If a valid execution context cannot be created due to incorrect arguments,
  // a "Response" with only errors is returned.
  try {
    const exeContext = buildExecutionContext(
      schema,
      document,
      rootValue,
      contextValue,
      variableValues,
      operationName,
      fieldResolver,
      typeResolver
    );
    // Return a Promise that will eventually resolve to the data described by
    // The "Response" section of the GraphQL specification.
    //
    // If errors are encountered while executing a GraphQL field, only that
    // field and its descendants will be omitted, and sibling fields will still
    // be executed. An execution which encounters errors will still result in a
    // resolved Promise.
    const data = executeOperation(exeContext, exeContext.operation, rootValue);
    return buildResponse(exeContext, data);
  } catch (e) {
    return Array.isArray(e) ? { errors: e } : { errors: [e] };
  }
}
/**
 * Given a completed execution context and data, build the { errors, data }
 * response defined by the "Response" section of the GraphQL specification.
 */
function buildResponse(
  exeContext: ExecutionContext,
  data: PromiseOrValue<ObjMap<any> | null>
): PromiseOrValue<ExecutionResult> {
  return exeContext.errors.length === 0
    ? { data }
    : { errors: exeContext.errors, data };
}
/**
 * Essential assertions before executing to provide developer feedback for
 * improper use of the GraphQL library.
 *
 * @internal
 */
export function assertValidExecutionArguments(
  schema: GraphQLSchema,
  document: DocumentNode,
  rawVariableValues: { [variable: string]: any }
): void {
  devAssert(document, "Must provide document.");

  // If the schema used for execution is invalid, throw an error.
  assertValidSchema(schema);

  // Variables, if provided, must be an object.
  devAssert(
    rawVariableValues == null || isObjectLike(rawVariableValues),
    "Variables must be provided as an Object where each property is a variable value. Perhaps look to see if an unparsed JSON string was provided."
  );
}
/**
 * Constructs a ExecutionContext object from the arguments passed to
 * execute, which we will pass throughout the other execution methods.
 *
 * Throws a GraphQLError if a valid execution context cannot be created.
 *
 * @internal
 */
export function buildExecutionContext(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue: any,
  contextValue: any,
  rawVariableValues: { [variable: string]: any },
  operationName?: string,
  fieldResolver?: GraphQLFieldResolver<any, any>,
  typeResolver?: GraphQLTypeResolver<any, any>
): ExecutionContext {
  let operation: OperationDefinitionNode | void;
  const fragments: ObjMap<FragmentDefinitionNode> = Object.create(null);
  for (const definition of document.definitions) {
    switch (definition.kind) {
      case Kind.OPERATION_DEFINITION:
        if (operationName == null) {
          if (operation !== undefined) {
            throw new GraphQLError(
              "Must provide operation name if query contains multiple operations."
            );
          }
          operation = definition;
        } else if (definition.name?.value === operationName) {
          operation = definition;
        }
        break;
      case Kind.FRAGMENT_DEFINITION:
        fragments[definition.name.value] = definition;
        break;
    }
  }

  if (!operation) {
    if (operationName != null) {
      throw new GraphQLError(`Unknown operation named "${operationName}".`);
    }
    throw new GraphQLError("Must provide an operation.");
  }
  // istanbul ignore next (See: 'https://github.com/graphql/graphql-js/issues/2203')
  const variableDefinitions = operation.variableDefinitions ?? [];

  const coercedVariableValues = getVariableValues(
    schema,
    variableDefinitions,
    rawVariableValues ?? {},
    { maxErrors: 50 }
  );

  if (coercedVariableValues.errors) {
    throw coercedVariableValues.errors;
  }

  return {
    schema,
    fragments,
    rootValue,
    contextValue,
    operation,
    variableValues: coercedVariableValues.coerced,
    fieldResolver: fieldResolver ?? defaultFieldResolver,
    typeResolver: typeResolver ?? defaultTypeResolver,
    errors: [],
  };
}
/**
 * Implements the "Evaluating operations" section of the spec.
 */
function executeOperation(
  exeContext: ExecutionContext,
  operation: OperationDefinitionNode,
  rootValue: any
): PromiseOrValue<ObjMap<any> | null> {
  const type = getOperationRootType(exeContext.schema, operation);
  const fields = collectFields(
    exeContext,
    type,
    operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );

  const path = undefined;

  // Errors from sub-fields of a NonNull type may propagate to the top level,
  // at which point we still log the error and null the parent field, which
  // in this case is the entire response.
  try {
    const result =
      operation.operation === "mutation"
        ? executeFieldsSerially(exeContext, type, rootValue, path, fields)
        : executeFields(exeContext, type, rootValue, path, fields);
    return result;
  } catch (error) {
    exeContext.errors.push(error);
    return null;
  }
}

function resolveField(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  source: any,
  fieldNodes: FieldNode[],
  path: Path
): PromiseOrValue<any> {
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name.value;

  const fieldDef = getFieldDef(exeContext.schema, parentType, fieldName);
  if (!fieldDef) {
    return;
  }

  const returnType = fieldDef.type;
  // Changed resolve function to extensions.resolveToCypherAst
  // Can still feed in a default resolveToCypher through exeContext under fieldResolver.
  const metadataFn =
    fieldDef.extensions.cypher.resolveMetadata ?? defaultMetadataResolver;
  const resolveFn =
    fieldDef.extensions.cypher.resolveToAst ?? exeContext.fieldResolver;

  const info = buildResolveInfo(
    exeContext,
    fieldDef,
    fieldNodes,
    parentType,
    path
  );

  // Get the resolve function, regardless of if its result is normal or abrupt (error).
  try {
    // Build a JS object of arguments from the field.arguments AST, using the
    // variables scope to fulfill any variable references.
    // TODO: find a way to memoize, in case this field is within a List type.
    const args = getArgumentValues(
      fieldDef,
      fieldNodes[0],
      exeContext.variableValues
    );

    // The resolve function's optional third argument is a context value that
    // is provided to every resolve function within an execution. It is commonly
    // used to represent an authenticated user, or request-specific caches.
    const contextValue = exeContext.contextValue;

    // resolveToCypher returns a function with signature:
    // CypherResolverResult :: (selectionSet: QueryBuilder[]) => result: QueryBuilder
    const fieldMetadata = metadataFn(
      { parent: source?.parent }, // is
      args,
      contextValue,
      info
    );

    // completeValue will need to be tweaked slightly and will have function signature:
    // (...currentArgTypes) => { [subfield: string]: { fieldMetadata: {[key: string]: any}, astNode: QueryBuilder} }
    const selections = completeValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      { parent: fieldMetadata } // Becomes `parent` argument of subfield's resolveFn(parent, params, ctx, resolveInfo)
    );

    const astNode = resolveFn(
      { parent: source?.parent, self: fieldMetadata, children: selections },
      args,
      contextValue,
      info
    );

    return { fieldMetadata, astNode };
  } catch (rawError) {
    const error = locatedError(rawError, fieldNodes, pathToArray(path));
    return handleFieldError(error, returnType, exeContext);
  }
}

function handleFieldError(
  error: GraphQLError,
  returnType: GraphQLOutputType,
  exeContext: ExecutionContext
): null {
  // If the field type is non-nullable, then it is resolved without any
  // protection from errors, however it still properly locates the error.
  if (isNonNullType(returnType)) {
    throw error;
  }
  // Otherwise, error protection is applied, logging the error and resolving
  // a null value for this field if one is encountered.
  exeContext.errors.push(error);
  return null;
}

function completeValue(
  exeContext: ExecutionContext,
  returnType: GraphQLOutputType,
  fieldNodes: FieldNode[],
  info: GraphQLResolveInfo,
  path: Path,
  result: any
): PromiseOrValue<any> {
  // If result is an Error, throw a located error.
  if (result instanceof Error) {
    throw result;
  }
  // Reference Implementation's `completeValue` switch-cased across
  // isNonNullType, isListType, isLeafType, isAbstractType, and isObjectType.

  // This implementation only cares about isAbstractType, isObjectType and default
  // for the following reasons:
  // - isAbstractType: until the way we deal with fragments in subfields can be clarified
  // - isObjectType: collect subfields
  // - default: Treat like a modified leaf type

  // If result value is null or undefined then return null.
  // This is the fallback return value for any `@neo4jignore` type stuff,
  if (result == null) {
    return null;
  }

  // If field type is an abstract type, Interface or Union, determine the
  // runtime Object type and complete for that type.
  if (isAbstractType(returnType)) {
    return completeAbstractValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
  }
  // If field type is Object, execute and complete all sub-selections.
  if (isObjectType(returnType)) {
    return completeObjectValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
  }
  // If it's not an object type, its result is already resolveToCypherAst.
  // May need to modify completeLeafValue if result needs further processing.
  return {};
}

/**
 * Complete a Scalar or Enum by serializing to a valid value, returning
 * null if serialization is not possible.
 */
function completeLeafValue(returnType: GraphQLLeafType, result: any): any {
  // Change me to extensions.resolveToCypher
  const serializedResult = returnType.serialize(result);
  if (serializedResult === undefined) {
    throw new Error(
      `Expected a value of type "${inspect(returnType)}" but ` +
        `received: ${inspect(result)}`
    );
  }
  return serializedResult;
}
/**
 * Complete a value of an abstract type by determining the runtime object type
 * of that value, then complete the value for that type.
 */
function completeAbstractValue(
  exeContext: ExecutionContext,
  returnType: GraphQLAbstractType,
  fieldNodes: FieldNode[],
  info: GraphQLResolveInfo,
  path: Path,
  result: any
): PromiseOrValue<ObjMap<any>> {
  // We don't need to figure out a runtimeType, but we may need to treat
  // fragment spreads as subqueries in a way that requires a different
  // `collectAndExecuteSubfields` implementation.
  // Ideas: - result could hold different information for each possible Type?

  // Don't need to change to extensions.resolveToCypher

  const resolveTypeFn = returnType.resolveType ?? exeContext.typeResolver;
  const contextValue = exeContext.contextValue;
  const runtimeTypeOrName = resolveTypeFn(
    result,
    contextValue,
    info,
    returnType
  );
  const runtimeTypeName: string = isNamedType(runtimeTypeOrName)
    ? runtimeTypeOrName.name
    : (runtimeTypeOrName as string);

  return completeObjectValue(
    exeContext,
    exeContext.schema.getType(runtimeTypeName) as GraphQLObjectType,
    fieldNodes,
    info,
    path,
    result
  );
}

/**
 * Complete an Object value by executing all sub-selections.
 */
function completeObjectValue(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: FieldNode[],
  info: GraphQLResolveInfo,
  path: Path,
  result: any
): PromiseOrValue<ObjMap<any>> {
  // Deleted isTypeOf check from reference implementation.

  // If returnType is ObjectType, the result will be a function with signature:
  // type SelectionInfo = { subqueries: QueryBuilder, returning: QueryBuilder }
  // (subfields: { [subfield: string]: SelectionInfo }) =>

  return collectAndExecuteSubfields(
    exeContext,
    returnType,
    fieldNodes,
    path,
    result
  );
}

/**
 * Implements the "Evaluating selection sets" section of the spec
 * for "write" mode.
 */
function executeFieldsSerially(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  sourceValue: any,
  path: Path,
  fields: ObjMap<FieldNode[]>
): PromiseOrValue<ObjMap<any>> {
  return Object.keys(fields).reduce((results, responseName) => {
    const fieldNodes = fields[responseName];
    const fieldPath = addPath(path, responseName, parentType.name);
    const result = resolveField(
      exeContext,
      parentType,
      sourceValue,
      fieldNodes,
      fieldPath
    );
    if (result === undefined) {
      return results;
    }
    results[responseName] = result;
    return results;
  }, Object.create(null));
}

function executeFields(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  sourceValue: any,
  path: Path,
  fields: { [key: string]: FieldNode[] }
): PromiseOrValue<ObjMap<any>> {
  const results = Object.create(null);

  for (const responseName of Object.keys(fields)) {
    const fieldNodes = fields[responseName];
    const fieldPath = addPath(path, responseName, parentType.name);
    const result = resolveField(
      exeContext,
      parentType,
      sourceValue,
      fieldNodes,
      fieldPath
    );
    if (result !== undefined) {
      results[responseName] = result;
    }
  }

  return results;
}

function collectAndExecuteSubfields(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: FieldNode[],
  path: Path,
  result: any
): PromiseOrValue<ObjMap<any>> {
  // Collect sub-fields to execute to complete this value.
  const subFieldNodes = collectSubfields(exeContext, returnType, fieldNodes);
  return executeFields(exeContext, returnType, result, path, subFieldNodes);
}

const collectSubfields = memoize3(_collectSubfields);
function _collectSubfields(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: FieldNode[]
): ObjMap<FieldNode[]> {
  let subFieldNodes = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (const node of fieldNodes) {
    if (node.selectionSet) {
      // Filter selections to account for selectionSets from Interface/Union fieldNodes.
      const selections = node.selectionSet.selections.filter(
        (selectionNode) => {
          return (
            selectionNode.kind === "FragmentSpread" ||
            selectionNode.kind === "InlineFragment" ||
            (selectionNode.kind === "Field" &&
              returnType.getFields()[selectionNode.name.value])
          );
        }
      );
      subFieldNodes = collectFields(
        exeContext,
        returnType,
        {
          ...node.selectionSet,
          selections,
        },
        subFieldNodes,
        visitedFragmentNames
      );
    }
  }
  return subFieldNodes;
}
