import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";

/** The JSON-render component catalog available to the generative UI tool. */
export const catalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
  },
  actions: {},
});
