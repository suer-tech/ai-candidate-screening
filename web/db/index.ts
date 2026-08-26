import { serverContainer } from "../server/configuration/container.ts";

export async function getDb() {
  return (await serverContainer()).db;
}
