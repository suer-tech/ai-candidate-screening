import { serverContainer } from "../configuration/container.ts";
import { PostgresProductRepository } from "./postgres-repository.ts";

export async function productRepository() {
  return new PostgresProductRepository((await serverContainer()).sql);
}
