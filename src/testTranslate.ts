import { buildASTSchema, parse, isObjectType } from "graphql";
import { applyNeo4jExtensions } from "./schema";
import { translate } from "./translate";

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
  return mockTest;
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
