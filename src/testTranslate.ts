import { buildASTSchema, parse, isObjectType, ExecutionResult } from "graphql";
import { isPromise } from "./utils/jsutils";
import { applyNeo4jExtensions } from "./schema";
import { translate } from "./translate";

const relatedField = {
  name: "Related Object - name",
  value: 100,
};

const mockTest = {
  __typename: "Test",
  someField: "Test Object - someField",
  relatedField,
};

const sdl = `
  type Test implements ITest {
    someField: String
    relatedField: Related @relationship(name: "RELATED" direction: "OUT")
  }
  
  type Related {
    name: String
    value: Int
  }
  
  interface ITest {
    someField: String
  }

  type InterfacedTest implements ITest {
    someField: String
    otherField: Int
  }

  type Query {
    testRelation: Test
    testInterface: ITest
  }
  
  directive @relationship(name: String!, direction: String!) on FIELD_DEFINITION
  `;

let schema = buildASTSchema(parse(sdl));
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

schema = applyNeo4jExtensions(schema, {});
const query = `
  query { 
      testInterface { 
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

if (isPromise(cypher)) {
  cypher.then((translation) => {
    console.log(JSON.stringify(translation.data, null, 2));
    console.log(translation.data.testInterface.astNode.queryString);
  });
} else {
  console.log(JSON.stringify(cypher.data, null, 2));
  console.log(cypher.data.testInterface.astNode.queryString);
}
