import { env } from "cloudflare:workers";
import { D1ProductRepository } from "./d1-repository.ts";

export function productRepository() {
  if (!env.DB) throw new Error("Product database binding DB is unavailable");
  return new D1ProductRepository(env.DB);
}
