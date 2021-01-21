import { getDirectiveValues, GraphQLField, GraphQLSchema } from "graphql";
// Will not make QueryBuilder dependent on graphql after this prototyping.
// TODO: swap out with some real QueryBuilder definitions.

export const addMatchClause = (name: string) => (alias: string) => (
  relationship: string
) => (sb: string) => sb + `MATCH ${relationship}(${alias}:${name})`;

export const addSubqueries = (subqueries: string) => (sb: string) =>
  subqueries ? sb + "\n" + subqueries : sb;

export const addReturnClause = (item: string) => (returnList: string) => (
  alias: string
) => (sb: string) =>
  sb + "\n" + `RETURN ${item} { ${returnList} }${alias ? ` AS ${alias}` : ""}`;

export const buildRelationship = (
  schema: GraphQLSchema,
  parentAlias: string,
  field: GraphQLField<unknown, unknown>
) => {
  const { name: relName, direction: relDir } = getDirectiveValues(
    schema.getDirective("relationship"),
    field.astNode
  );
  return `(${parentAlias})${relDir == "IN" ? "<-" : "-"}[:${relName}]${
    relDir == "OUT" ? "->" : "-"
  }`;
};
