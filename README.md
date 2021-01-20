# neo4j-graphql-ideas

Staging and demonstration area for some ideas for `@neo4j/graphql` library.

### Model `translate` from `graphql/execution/execute`

- Decouples cypher query construction from GraphQL query traversal.
- Slightly modifies the order of operations in `resolveField()` in `graphql/execution/execute` to resolve subfields _before_ finalizing the resolution.
- Promotes separation of concerns to reduce on-going technical debt.
- Tightly mirrors the familiar GraphQL resolver pattern, which gives a familiar entrypoint for developer experience and allows for the easier porting of existing tooling.
- Example: `testTranslate.ts`

- Still to-do:
  - Lots of cleaning because this was a quick-and-dirty exercise.
  - Figure out how Union/Interface types would work in terms of `completeAbstractValues`
