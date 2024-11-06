import { writeFile } from "node:fs/promises";

import { Command } from "@commander-js/extra-typings";
import { z } from "zod";

import { Scopes } from "../scopes.js";

const BIGCOMMERCE_API_BASE_PATH = "https://api.bigcommerce.com";

export const catalog = new Command("catalog")
  .requiredOption("--store-hash <storeHash>", "BigCommerce store hash")
  .requiredOption("--access-token <accessToken>", "BigCommerce access token")
  .action(async (options) => {
    const { storeHash, accessToken } = options;

    const scopeRequest = new Request(
      `${BIGCOMMERCE_API_BASE_PATH}/stores/${storeHash}/graphql`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "x-auth-token": accessToken,
        },
        body: JSON.stringify({
          query:
            "query getScopesForToken { client { scopes { edges { node } } } }",
        }),
      },
    );

    const scopeResponse = await fetch(scopeRequest);

    if (!scopeResponse.ok || scopeResponse.status !== 200) {
      console.error(
        `Received ${scopeResponse.status} ${scopeResponse.statusText} from ${scopeRequest.url}\n`,
      );
      process.exit(1);
    }

    const ScopeResponseSchema = z.object({
      data: z.object({
        client: z.object({
          scopes: z.object({ edges: z.array(z.object({ node: z.string() })) }),
        }),
      }),
    });

    const actualScopes = ScopeResponseSchema.parse(
      await scopeResponse.json(),
    ).data.client.scopes.edges.map((edge) => edge.node);

    const requiredScopes = [Scopes.STORE_V2_PRODUCTS];

    const missingScopes = requiredScopes.filter((requiredScope) => {
      return !actualScopes.some(
        (actualScope) =>
          actualScope.includes(requiredScope) ||
          requiredScope.includes(actualScope),
      );
    });

    if (missingScopes.length > 0) {
      console.error(`Missing scopes: ${missingScopes.join(", ")}\n`);
      process.exit(1);
    }

    const productsRequest = new Request(
      `${BIGCOMMERCE_API_BASE_PATH}/stores/${storeHash}/v3/catalog/products`,
      {
        headers: {
          accept: "application/json",
          "x-auth-token": accessToken,
        },
      },
    );

    const productsResponse = await fetch(productsRequest);

    if (!productsResponse.ok || productsResponse.status !== 200) {
      console.error(
        `Received ${productsResponse.status} ${productsResponse.statusText} from ${productsRequest.url}\n`,
      );
      process.exit(1);
    }

    const ProductsResponseSchema = z.object({
      data: z.array(z.object({}).passthrough()),
      meta: z.object({
        pagination: z.object({
          links: z.object({
            next: z.string().optional(),
          }),
        }),
      }),
    });

    const productsData = ProductsResponseSchema.parse(
      await productsResponse.json(),
    );

    let allProducts = [...productsData.data];
    let nextUrl = productsData.meta.pagination.links.next;

    while (nextUrl) {
      const nextRequest = new Request(
        `${BIGCOMMERCE_API_BASE_PATH}/stores/${storeHash}/v3/catalog/products${nextUrl}`,
        {
          headers: {
            accept: "application/json",
            "x-auth-token": accessToken,
          },
        },
      );

      console.log(`${nextRequest.method} ${nextRequest.url}`);

      const nextResponse = await fetch(nextRequest);

      const requestsLeft = parseInt(
        nextResponse.headers.get("X-Rate-Limit-Requests-Left"),
      );
      const resetMs = parseInt(
        nextResponse.headers.get("X-Rate-Limit-Time-Reset-Ms"),
      );

      console.log(`Requests left: ${requestsLeft} - Reset in ${resetMs}ms`);

      if (requestsLeft < 1) {
        console.log(
          `Rate limit reached. Waiting ${resetMs}ms before continuing...`,
        );
        await new Promise((resolve) => setTimeout(resolve, resetMs));
      }

      if (!nextResponse.ok || nextResponse.status !== 200) {
        console.error(
          `Received ${nextResponse.status} ${nextResponse.statusText} from ${nextRequest.url}\n`,
        );
        process.exit(1);
      }

      const nextData = ProductsResponseSchema.parse(await nextResponse.json());

      allProducts = [...allProducts, ...nextData.data];
      nextUrl = nextData.meta.pagination.links.next;
    }

    await writeFile(
      "products.json",
      JSON.stringify(allProducts, null, 2),
      "utf8",
    );

    console.log("Products written to products.json");
  });
